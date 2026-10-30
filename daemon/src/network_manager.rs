//! The tunnel as a NetworkManager connection.
//!
//! On hosts with NetworkManager the service asks it to create the WireGuard
//! connection, as Proton VPN does. The desktop then shows the VPN indicator,
//! lists "K1VPN" in its network menu, and treats our disconnect as a user
//! deactivation instead of reporting "Connection failed". The connection is
//! volatile: NetworkManager keeps it, including the private key, only in
//! memory and deletes it, with its interface, when it is deactivated.
//!
//! Without NetworkManager, or with the Snap `network-manager` plug
//! disconnected, `activate` reports `Unavailable` and the service creates the
//! tunnel itself; `unmanage` then keeps NetworkManager from adopting that
//! interface as an external connection, which would bring the false failure
//! notice back.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use zbus::wire::{OwnedObjectPath, OwnedVariant, Variant};
use zbus::{Connection, Proxy, block_on};
use zeroize::Zeroizing;

const SERVICE: &str = "org.freedesktop.NetworkManager";
const MANAGER_PATH: &str = "/org/freedesktop/NetworkManager";
const MANAGER_INTERFACE: &str = "org.freedesktop.NetworkManager";
const ACTIVE_INTERFACE: &str = "org.freedesktop.NetworkManager.Connection.Active";
const DEVICE_INTERFACE: &str = "org.freedesktop.NetworkManager.Device";
const CONNECTION_NAME: &str = "K1VPN";
/// `NM_ACTIVE_CONNECTION_STATE_ACTIVATED` and `_DEACTIVATED`.
const ACTIVATED: u32 = 2;
const DEACTIVATED: u32 = 4;
/// Below this exclusive priority, other connections' DNS servers are not
/// used while the tunnel is up.
const DNS_PRIORITY: i32 = -1500;
const CALL_TIMEOUT: Duration = Duration::from_secs(3);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(20);
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(10);
/// NetworkManager learns about a new link asynchronously from netlink.
const DEVICE_WAIT: Duration = Duration::from_secs(1);
const POLL: Duration = Duration::from_millis(50);

/// Everything NetworkManager needs for the connection.
pub struct Tunnel {
    pub interface: &'static str,
    pub private_key: Zeroizing<String>,
    pub peer_public_key: String,
    pub endpoint: String,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u16>,
    pub fwmark: u32,
    pub mtu: u32,
    pub address: IpAddr,
    pub dns: Vec<String>,
}

pub enum ActivationError {
    /// No NetworkManager to ask; the caller creates the tunnel itself.
    Unavailable,
    /// NetworkManager is present and could not bring the tunnel up.
    Failed,
}

/// Runs `operation` on its own thread so a stalled bus is bounded.
fn bounded<T: Send + 'static>(
    timeout: Duration,
    operation: impl FnOnce() -> zbus::Result<T> + Send + 'static,
) -> Option<zbus::Result<T>> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(operation());
    });
    receiver.recv_timeout(timeout).ok()
}

fn error_name(error: &zbus::Error) -> Option<&str> {
    match error {
        zbus::Error::MethodError(name, _, _) => Some(name.as_str()),
        _ => None,
    }
}

/// No NetworkManager on the bus, or the Snap plug is not connected.
fn unavailable(error: &zbus::Error) -> bool {
    matches!(
        error_name(error),
        Some(
            "org.freedesktop.DBus.Error.ServiceUnknown"
                | "org.freedesktop.DBus.Error.NameHasNoOwner"
                | "org.freedesktop.DBus.Error.AccessDenied"
        )
    )
}

fn manager(connection: &Connection) -> zbus::Result<Proxy<'static>> {
    block_on(Proxy::new(
        connection,
        SERVICE,
        MANAGER_PATH,
        MANAGER_INTERFACE,
    ))
}

fn address_settings<'a>(address: IpAddr, dns: &'a [String]) -> HashMap<&'static str, Variant<'a>> {
    let prefix: u32 = if address.is_ipv4() { 32 } else { 128 };
    let address_data: Vec<HashMap<&str, Variant>> = vec![HashMap::from([
        ("address", Variant::from(address.to_string())),
        ("prefix", Variant::from(prefix)),
    ])];
    let dns: Vec<&str> = dns.iter().map(String::as_str).collect();
    HashMap::from([
        ("method", Variant::from("manual")),
        ("address-data", Variant::from(address_data)),
        ("dns-data", Variant::from(dns)),
        // "~." routes every query to the tunnel resolver.
        ("dns-search", Variant::from(vec!["~."])),
        ("dns-priority", Variant::from(DNS_PRIORITY)),
        ("ignore-auto-dns", Variant::from(true)),
    ])
}

fn disabled_family<'a>() -> HashMap<&'static str, Variant<'a>> {
    HashMap::from([("method", Variant::from("disabled"))])
}

fn settings(tunnel: &Tunnel) -> HashMap<&'static str, HashMap<&'static str, Variant<'_>>> {
    let mut peer = HashMap::from([
        ("public-key", Variant::from(tunnel.peer_public_key.as_str())),
        ("endpoint", Variant::from(tunnel.endpoint.as_str())),
        (
            "allowed-ips",
            Variant::from(
                tunnel
                    .allowed_ips
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            ),
        ),
    ]);
    if let Some(keepalive) = tunnel.persistent_keepalive {
        peer.insert("persistent-keepalive", Variant::from(u32::from(keepalive)));
    }
    let (ipv4, ipv6) = if tunnel.address.is_ipv4() {
        (
            address_settings(tunnel.address, &tunnel.dns),
            disabled_family(),
        )
    } else {
        (
            disabled_family(),
            address_settings(tunnel.address, &tunnel.dns),
        )
    };
    HashMap::from([
        (
            "connection",
            HashMap::from([
                ("id", Variant::from(CONNECTION_NAME)),
                ("type", Variant::from("wireguard")),
                ("interface-name", Variant::from(tunnel.interface)),
                ("autoconnect", Variant::from(false)),
            ]),
        ),
        (
            "wireguard",
            HashMap::from([
                ("private-key", Variant::from(tunnel.private_key.as_str())),
                // 0: NetworkManager holds the key itself; no secret agent.
                ("private-key-flags", Variant::from(0u32)),
                ("fwmark", Variant::from(tunnel.fwmark)),
                // With a /0 peer route NetworkManager adds the full-tunnel
                // policy routing itself, in the table named by the fwmark.
                ("mtu", Variant::from(tunnel.mtu)),
                ("peers", Variant::from(vec![peer])),
            ]),
        ),
        ("ipv4", ipv4),
        ("ipv6", ipv6),
    ])
}

fn wait_for_state(active: &Proxy, wanted: u32, timeout: Duration) -> zbus::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        let state = match block_on(active.get_property::<u32>("State")) {
            Ok(state) => state,
            // The object disappears once the connection is gone.
            Err(_) if wanted == DEACTIVATED => return Ok(true),
            Err(error) => return Err(error),
        };
        if state == wanted {
            return Ok(true);
        }
        if state == DEACTIVATED || Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(POLL);
    }
}

/// Creates and activates the volatile connection, returning once
/// NetworkManager reports it activated.
pub fn activate(tunnel: Tunnel) -> Result<(), ActivationError> {
    let outcome = bounded(ACTIVATION_TIMEOUT + CALL_TIMEOUT, move || {
        let connection = block_on(Connection::system())?;
        let manager = manager(&connection)?;
        let options = HashMap::from([("persist", Variant::from("volatile"))]);
        let root = OwnedObjectPath::try_from("/")?;
        let (_, active, _): (
            OwnedObjectPath,
            OwnedObjectPath,
            HashMap<String, OwnedVariant>,
        ) = block_on(manager.call(
            "AddAndActivateConnection2",
            &(settings(&tunnel), &root, &root, options),
        ))?;
        drop(tunnel);
        let active = block_on(Proxy::new(&connection, SERVICE, active, ACTIVE_INTERFACE))?;
        wait_for_state(&active, ACTIVATED, ACTIVATION_TIMEOUT)
    });
    match outcome {
        Some(Ok(true)) => Ok(()),
        Some(Ok(false)) => {
            eprintln!("k1vpnd: NetworkManager did not activate the tunnel");
            Err(ActivationError::Failed)
        }
        Some(Err(error)) if unavailable(&error) => Err(ActivationError::Unavailable),
        Some(Err(error)) => {
            eprintln!("k1vpnd: NetworkManager rejected the tunnel: {error}");
            Err(ActivationError::Failed)
        }
        None => {
            eprintln!("k1vpnd: NetworkManager did not answer in time");
            Err(ActivationError::Failed)
        }
    }
}

fn active_connection(
    connection: &Connection,
    interface: &str,
) -> zbus::Result<Option<OwnedObjectPath>> {
    let path: OwnedObjectPath =
        match block_on(manager(connection)?.call("GetDeviceByIpIface", &(interface,))) {
            Ok(path) => path,
            Err(error)
                if error_name(&error) == Some("org.freedesktop.NetworkManager.UnknownDevice") =>
            {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
    let device = block_on(Proxy::new(connection, SERVICE, path, DEVICE_INTERFACE))?;
    let active: OwnedObjectPath = block_on(device.get_property("ActiveConnection"))?;
    Ok((active.as_str() != "/").then_some(active))
}

/// Deactivates our connection on `interface`, if NetworkManager has one, so
/// the desktop records a user disconnect. Returns whether NetworkManager no
/// longer holds the tunnel; interfaces it does not manage are left to the
/// caller's own cleanup.
pub fn deactivate(interface: &'static str) -> bool {
    let outcome = bounded(TEARDOWN_TIMEOUT + CALL_TIMEOUT, move || {
        let connection = block_on(Connection::system())?;
        let Some(active) = active_connection(&connection, interface)? else {
            return Ok(true);
        };
        let active_proxy = block_on(Proxy::new(
            &connection,
            SERVICE,
            active.clone(),
            ACTIVE_INTERFACE,
        ))?;
        let id: String = block_on(active_proxy.get_property("Id"))?;
        // Never touch a connection the user made themselves on this name.
        if id != CONNECTION_NAME {
            return Ok(true);
        }
        block_on(manager(&connection)?.call::<_, _, ()>("DeactivateConnection", &(&active,)))?;
        let active = block_on(Proxy::new(&connection, SERVICE, active, ACTIVE_INTERFACE))?;
        wait_for_state(&active, DEACTIVATED, TEARDOWN_TIMEOUT)
    });
    match outcome {
        Some(Ok(done)) => done,
        Some(Err(error)) if unavailable(&error) => true,
        Some(Err(error)) => {
            eprintln!("k1vpnd: NetworkManager did not release the tunnel: {error}");
            false
        }
        None => {
            eprintln!("k1vpnd: NetworkManager did not answer in time");
            false
        }
    }
}

/// Keeps NetworkManager from adopting an interface the service created
/// itself. Best effort and bounded.
pub fn unmanage(interface: &'static str) {
    let outcome = bounded(CALL_TIMEOUT, move || {
        let connection = block_on(Connection::system())?;
        let manager = manager(&connection)?;
        let deadline = Instant::now() + DEVICE_WAIT;
        let path: OwnedObjectPath = loop {
            match block_on(manager.call("GetDeviceByIpIface", &(interface,))) {
                Ok(path) => break path,
                Err(error)
                    if error_name(&error)
                        == Some("org.freedesktop.NetworkManager.UnknownDevice")
                        && Instant::now() < deadline =>
                {
                    thread::sleep(POLL)
                }
                Err(error) => return Err(error),
            }
        };
        let properties = block_on(Proxy::new(
            &connection,
            SERVICE,
            path,
            "org.freedesktop.DBus.Properties",
        ))?;
        block_on(
            properties
                .call::<_, _, ()>("Set", &(DEVICE_INTERFACE, "Managed", Variant::from(false))),
        )
    });
    match outcome {
        Some(Ok(())) => {}
        Some(Err(error)) if unavailable(&error) => {}
        Some(Err(error)) => eprintln!("k1vpnd: NetworkManager kept managing {interface}: {error}"),
        None => eprintln!("k1vpnd: NetworkManager did not answer in time"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tunnel(address: &str, allowed: Vec<String>, dns: Vec<String>) -> Tunnel {
        Tunnel {
            interface: "k1vpn0",
            private_key: Zeroizing::new("private".into()),
            peer_public_key: "public".into(),
            endpoint: "203.0.113.9:51820".into(),
            allowed_ips: allowed,
            persistent_keepalive: Some(25),
            fwmark: 51820,
            mtu: 1420,
            address: address.parse().unwrap(),
            dns,
        }
    }

    #[test]
    fn describes_a_volatile_full_tunnel_with_exclusive_dns() {
        let tunnel = tunnel(
            "10.8.0.2",
            vec!["0.0.0.0/0".into()],
            vec!["10.8.0.1".into()],
        );
        let settings = settings(&tunnel);
        assert_eq!(settings["connection"]["type"], Variant::from("wireguard"));
        assert_eq!(
            settings["connection"]["interface-name"],
            Variant::from("k1vpn0")
        );
        assert_eq!(settings["connection"]["autoconnect"], Variant::from(false));
        assert_eq!(settings["wireguard"]["fwmark"], Variant::from(51820u32));
        assert_eq!(settings["ipv4"]["method"], Variant::from("manual"));
        assert_eq!(
            settings["ipv4"]["dns-priority"],
            Variant::from(DNS_PRIORITY)
        );
        assert_eq!(settings["ipv4"]["dns-search"], Variant::from(vec!["~."]));
        assert_eq!(settings["ipv6"]["method"], Variant::from("disabled"));
    }

    #[test]
    fn an_ipv6_tunnel_disables_ipv4_on_the_interface() {
        let tunnel = tunnel("fd00::2", vec!["::/0".into()], vec!["fd00::1".into()]);
        let settings = settings(&tunnel);
        assert_eq!(settings["ipv4"]["method"], Variant::from("disabled"));
        assert_eq!(settings["ipv6"]["method"], Variant::from("manual"));
    }

    /// Against the host's real NetworkManager, routing only the TEST-NET
    /// prefix and with no DNS, so no traffic is affected. Run by hand:
    /// `cargo test -- --ignored network_manager_accepts`.
    #[test]
    #[ignore = "needs a desktop session with NetworkManager"]
    fn network_manager_accepts_and_releases_the_connection() {
        assert!(nix::net::if_::if_nametoindex("k1vpntest0").is_err());
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                deactivate("k1vpntest0");
            }
        }
        let _cleanup = Cleanup;
        // Its own interface name, so a live K1VPN session is not touched.
        let mut test = tunnel("192.0.2.2", vec!["192.0.2.0/24".into()], vec![]);
        test.interface = "k1vpntest0";
        // Throwaway keys: any 32 bytes are a valid WireGuard key.
        let key = |byte: u8| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, [byte; 32])
        };
        test.private_key = Zeroizing::new(key(1));
        test.peer_public_key = key(2);
        test.endpoint = "192.0.2.1:51820".into();
        let connection = block_on(Connection::system()).unwrap();
        let mut settings = settings(&test);
        let ipv4 = settings.get_mut("ipv4").unwrap();
        for key in ["dns-data", "dns-search", "dns-priority"] {
            ipv4.remove(key);
        }
        let root = OwnedObjectPath::try_from("/").unwrap();
        let options = HashMap::from([("persist", Variant::from("volatile"))]);
        let (_, active, _): (
            OwnedObjectPath,
            OwnedObjectPath,
            HashMap<String, OwnedVariant>,
        ) = block_on(manager(&connection).unwrap().call(
            "AddAndActivateConnection2",
            &(settings, &root, &root, options),
        ))
        .unwrap();
        let active = block_on(Proxy::new(&connection, SERVICE, active, ACTIVE_INTERFACE)).unwrap();
        assert!(wait_for_state(&active, ACTIVATED, ACTIVATION_TIMEOUT).unwrap());
        assert!(deactivate("k1vpntest0"));
        assert!(nix::net::if_::if_nametoindex("k1vpntest0").is_err());
    }
}
