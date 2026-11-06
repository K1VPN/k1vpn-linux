use nix::sys::socket::{getsockopt, sockopt::PeerCredentials};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use zbus::wire::Variant;
use zbus::{Connection, block_on};

const ACTION_ID: &str = "com.k1vpn.network-control";
const AUTHORITY_SERVICE: &str = "org.freedesktop.PolicyKit1";
const AUTHORITY_PATH: &str = "/org/freedesktop/PolicyKit1/Authority";
const AUTHORITY_INTERFACE: &str = "org.freedesktop.PolicyKit1.Authority";
const ALLOW_USER_INTERACTION: u32 = 1;
const AUTHORIZATION_TIMEOUT: Duration = Duration::from_secs(60);

static NEXT_CANCELLATION: AtomicU64 = AtomicU64::new(1);

/// The race-free polkit subject: the same `pid,start-time,uid` triple that
/// `pkcheck --process` sends, so a reused PID cannot inherit authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Subject {
    pid: u32,
    start_time: u64,
    uid: u32,
}

fn process_start_time(pid: i32) -> io::Result<u64> {
    if pid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid peer pid",
        ));
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let command_end = stat.rfind(')').ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "invalid peer process metadata")
    })?;
    let fields = stat
        .get(command_end + 1..)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid peer metadata"))?
        .split_whitespace()
        .collect::<Vec<_>>();
    // The first token after the command is field 3 (state); starttime is field 22.
    fields
        .get(19)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing peer start time"))?
        .parse::<u64>()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid peer start time"))
}

fn subject_details(subject: Subject) -> HashMap<&'static str, Variant<'static>> {
    HashMap::from([
        ("pid", Variant::U32(subject.pid)),
        ("start-time", Variant::U64(subject.start_time)),
        // polkit encodes a unix-process uid as int32.
        ("uid", Variant::I32(subject.uid as i32)),
    ])
}

fn check_authorization(
    connection: &Connection,
    subject: Subject,
    cancellation_id: &str,
) -> zbus::Result<bool> {
    let details: HashMap<&str, &str> = HashMap::new();
    let reply = block_on(connection.call_method(
        Some(AUTHORITY_SERVICE),
        AUTHORITY_PATH,
        Some(AUTHORITY_INTERFACE),
        "CheckAuthorization",
        &(
            ("unix-process", subject_details(subject)),
            ACTION_ID,
            details,
            ALLOW_USER_INTERACTION,
            cancellation_id,
        ),
    ))?;
    let (authorized, _challenge, _details): (bool, bool, HashMap<String, String>) =
        reply.body().deserialize()?;
    Ok(authorized)
}

/// Asks polkit over the system bus, so neither layout depends on a host
/// `pkcheck`. An unanswered prompt is cancelled after the timeout.
fn authorize(subject: Subject) -> io::Result<bool> {
    let connection = block_on(Connection::system())
        .map_err(|error| io::Error::other(format!("cannot reach polkit: {error}")))?;
    let cancellation_id = format!(
        "k1vpnd-{}",
        NEXT_CANCELLATION.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = mpsc::sync_channel(1);
    {
        let connection = connection.clone();
        let cancellation_id = cancellation_id.clone();
        thread::spawn(move || {
            let _ = sender.send(check_authorization(&connection, subject, &cancellation_id));
        });
    }
    match receiver.recv_timeout(AUTHORIZATION_TIMEOUT) {
        Ok(Ok(authorized)) => Ok(authorized),
        Ok(Err(error)) => Err(io::Error::other(format!(
            "polkit authorization failed: {error}"
        ))),
        Err(_) => {
            // Cancellation must come from the connection that asked.
            let _ = block_on(connection.call_method(
                Some(AUTHORITY_SERVICE),
                AUTHORITY_PATH,
                Some(AUTHORITY_INTERFACE),
                "CancelCheckAuthorization",
                &(cancellation_id.as_str(),),
            ));
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "authorization request timed out",
            ))
        }
    }
}

pub fn authorize_network_control(stream: &UnixStream) -> io::Result<()> {
    let peer = getsockopt(stream, PeerCredentials)
        .map_err(|error| io::Error::other(format!("cannot identify socket peer: {error}")))?;
    let start_time = process_start_time(peer.pid())?;
    let subject = Subject {
        pid: peer.pid() as u32,
        start_time,
        uid: peer.uid(),
    };
    if authorize(subject)? {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "polkit denied the operation",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_this_process_start_time() {
        assert!(process_start_time(std::process::id() as i32).unwrap() > 0);
    }

    #[test]
    fn rejects_non_process_ids() {
        assert_eq!(
            process_start_time(0).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn encodes_the_race_free_unix_process_subject() {
        let details = subject_details(Subject {
            pid: 4242,
            start_time: 987_654,
            uid: 1000,
        });
        assert_eq!(details.len(), 3);
        assert_eq!(details["pid"], Variant::U32(4242));
        assert_eq!(details["start-time"], Variant::U64(987_654));
        assert_eq!(details["uid"], Variant::I32(1000));
    }
}
