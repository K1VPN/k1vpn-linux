use crate::authorization;
use crate::paths;
use crate::protocol::{self, MAX_MESSAGE_BYTES};
use crate::recovery::RecoveryJournal;
use crate::shutdown::ShutdownSignals;
use crate::snap;
use crate::tunnel::{TunnelManager, verify_tunnel};
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;
use zeroize::Zeroize;

const IO_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_CONNECTIONS: usize = 32;

struct ConnectionSlot(Arc<AtomicUsize>);

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

fn reserve_slot(active: &Arc<AtomicUsize>) -> Option<ConnectionSlot> {
    active
        .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            (current < MAX_CONNECTIONS).then_some(current + 1)
        })
        .ok()
        .map(|_| ConnectionSlot(Arc::clone(active)))
}

fn prepare_socket(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_socket() => {
            if UnixStream::connect(path).is_ok() {
                return Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    "another service instance is already listening",
                ));
            }
            fs::remove_file(path)
        }
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "refusing to replace a non-socket filesystem entry",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn write_response(stream: &mut UnixStream, response: &[u8]) -> io::Result<()> {
    stream.write_all(response)?;
    stream.flush()
}

fn serve_connection(
    mut stream: UnixStream,
    _slot: ConnectionSlot,
    manager: Arc<Mutex<TunnelManager>>,
    stopping: Arc<AtomicBool>,
) -> io::Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;

    let mut input = Vec::new();
    let mut reader = BufReader::new(&stream).take((MAX_MESSAGE_BYTES + 1) as u64);
    reader.read_until(b'\n', &mut input)?;
    if input.last() == Some(&b'\n') {
        input.pop();
        if input.last() == Some(&b'\r') {
            input.pop();
        }
    }
    if let Some(request_id) = protocol::authorization_request_id(&input) {
        if !snap::required_interfaces_connected() {
            return write_response(
                &mut stream,
                &protocol::error(request_id, "snap_interfaces_missing", snap::MISSING_MESSAGE),
            );
        }
        if let Err(error) = authorization::authorize_network_control(&stream) {
            eprintln!("k1vpnd: authorization denied: {error}");
            return write_response(
                &mut stream,
                &protocol::error(
                    request_id,
                    "authorization_required",
                    "authorization is required for this operation",
                ),
            );
        }
        if let Some(mutation) = protocol::parse_mutation(&input) {
            input.zeroize();
            let response = match mutation {
                Err(id) => protocol::error(
                    id,
                    "invalid_tunnel_config",
                    "the tunnel configuration is invalid",
                ),
                Ok(mutation) => {
                    let id = mutation.id();
                    let mut manager = manager
                        .lock()
                        .map_err(|_| io::Error::other("tunnel manager lock poisoned"))?;
                    if stopping.load(Ordering::Acquire) {
                        return write_response(
                            &mut stream,
                            &protocol::error(id, "service_stopping", "the VPN service is stopping"),
                        );
                    }
                    let result = manager.execute(mutation);
                    match result {
                        Ok(value) => protocol::success(id, value),
                        Err(error) => protocol::error(id, error.code(), error.message()),
                    }
                }
            };
            return write_response(&mut stream, &response);
        }
    }
    if let Some(id) = protocol::verify_request_id(&input) {
        // The check waits for kernel counters; release the manager first so
        // status and mutations are never blocked behind it.
        let target = manager
            .lock()
            .map_err(|_| io::Error::other("tunnel manager lock poisoned"))?
            .verify_target();
        return write_response(&mut stream, &protocol::success(id, verify_tunnel(target)));
    }
    let mut manager = manager
        .lock()
        .map_err(|_| io::Error::other("tunnel manager lock poisoned"))?;
    if let Some(id) = protocol::status_request_id(&input) {
        return write_response(&mut stream, &protocol::success(id, manager.status()));
    }
    let recovery_required = manager.recovery_required();
    write_response(&mut stream, &protocol::handle(&input, recovery_required))
}

pub fn run() -> io::Result<()> {
    let signals = ShutdownSignals::new()?;
    let paths = paths::init()?;
    paths::prepare(paths)?;
    let socket = paths.socket();
    prepare_socket(&socket)?;
    let listener = UnixListener::bind(&socket)?;
    listener.set_nonblocking(true)?;
    // Opening the socket does not authorize mutations: polkit checks the
    // kernel-provided identity on every mutating request. Desktop launches
    // must also work before a newly installed group reaches the login session.
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o666))?;
    let active = Arc::new(AtomicUsize::new(0));
    let mut tunnel = TunnelManager::new(RecoveryJournal::production());
    tunnel.adopt();
    paths.clear_refresh_marker();
    let manager = Arc::new(Mutex::new(tunnel));

    let stopping = Arc::new(AtomicBool::new(false));
    loop {
        if signals.requested()? {
            stopping.store(true, Ordering::Release);
            manager
                .lock()
                .map_err(|_| io::Error::other("tunnel manager lock poisoned"))?
                .shutdown()
                .map_err(|error| io::Error::other(error.message()))?;
            fs::remove_file(&socket)?;
            return Ok(());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(error) => return Err(error),
        };
        let Some(slot) = reserve_slot(&active) else {
            let _ = write_response(
                &mut stream,
                &protocol::error(0, "busy", "too many concurrent connections"),
            );
            continue;
        };
        let manager = Arc::clone(&manager);
        let stopping = Arc::clone(&stopping);
        thread::spawn(move || {
            if let Err(error) = serve_connection(stream, slot, manager, stopping) {
                eprintln!("k1vpnd: client request failed: {error}");
            }
        });
    }
}
