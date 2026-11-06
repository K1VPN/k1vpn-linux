//! Tunnel DNS through systemd-resolved's D-Bus API.
//!
//! The settings belong to the tunnel link only; systemd-resolved drops them
//! with the link, so teardown needs no resolver call and no host-wide
//! resolver file is ever edited. zbus avoids sd-bus's abstract debug socket,
//! which the Snap AppArmor policy does not allow binding.

use std::net::IpAddr;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use zbus::{Connection, Proxy};

const TIMEOUT: Duration = Duration::from_secs(10);
/// `AF_INET` and `AF_INET6`, as systemd-resolved expects them.
const AF_INET: i32 = 2;
const AF_INET6: i32 = 10;

fn encode(servers: &[IpAddr]) -> Vec<(i32, Vec<u8>)> {
    servers
        .iter()
        .map(|address| match address {
            IpAddr::V4(ip) => (AF_INET, ip.octets().to_vec()),
            IpAddr::V6(ip) => (AF_INET6, ip.octets().to_vec()),
        })
        .collect()
}

async fn set_link_dns(index: i32, servers: Vec<(i32, Vec<u8>)>) -> zbus::Result<()> {
    let connection = Connection::system().await?;
    let resolved = Proxy::new(
        &connection,
        "org.freedesktop.resolve1",
        "/org/freedesktop/resolve1",
        "org.freedesktop.resolve1.Manager",
    )
    .await?;
    resolved
        .call::<_, _, ()>("SetLinkDNS", &(index, servers))
        .await?;
    // The "~." routing domain sends every query to the tunnel resolver.
    resolved
        .call::<_, _, ()>("SetLinkDomains", &(index, vec![(".", true)]))
        .await?;
    resolved
        .call::<_, _, ()>("SetLinkDefaultRoute", &(index, true))
        .await
}

/// Applies `servers` to the link with `index`. Errors are logged here, since
/// clients only ever receive a generic failure.
pub fn apply(index: u32, servers: &[IpAddr]) -> Result<(), ()> {
    let index = i32::try_from(index).map_err(|_| ())?;
    let servers = encode(servers);
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(zbus::block_on(set_link_dns(index, servers)));
    });
    match receiver.recv_timeout(TIMEOUT) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => {
            eprintln!("k1vpnd: systemd-resolved rejected the tunnel DNS: {error}");
            Err(())
        }
        Err(_) => {
            eprintln!("k1vpnd: systemd-resolved did not answer in time");
            Err(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_both_address_families_for_resolved() {
        let values = encode(&["10.0.0.1".parse().unwrap(), "fd00::1".parse().unwrap()]);
        assert_eq!(values[0], (AF_INET, vec![10, 0, 0, 1]));
        assert_eq!(values[1].0, AF_INET6);
        assert_eq!(values[1].1.len(), 16);
    }
}
