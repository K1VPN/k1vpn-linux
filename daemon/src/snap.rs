//! Snap interfaces the service needs before it can change networking.
//!
//! Until the Store grants auto-connection they are connected by hand. A
//! missing one would otherwise surface only as a generic networking or
//! authorization failure, so mutations check them first and report exactly
//! what the user has to run.

use crate::paths::{self, Layout};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const SNAPCTL: &str = "/usr/bin/snapctl";
const REQUIRED: [&str; 3] = ["network-control", "firewall-control", "k1vpn-polkit"];
const TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(20);

pub const MISSING_MESSAGE: &str = "K1VPN needs permission to manage the network. In a terminal, run: \
sudo snap connect k1vpn:network-control && sudo snap connect k1vpn:firewall-control && \
sudo snap connect k1vpn:k1vpn-polkit :polkit";

/// True outside a Snap. Inside one, false only when snapd reports a required
/// plug as disconnected; if snapctl itself cannot answer, the operation runs
/// and fails closed on its own.
pub fn required_interfaces_connected() -> bool {
    if paths::get().layout != Layout::Snap {
        return true;
    }
    REQUIRED
        .iter()
        .all(|plug| is_connected(plug).unwrap_or(true))
}

fn is_connected(plug: &str) -> Option<bool> {
    let mut command = Command::new(SNAPCTL);
    command.env_clear();
    // snapctl identifies this snap to snapd with the cookie snapd provided.
    if let Some(cookie) = std::env::var_os("SNAP_COOKIE") {
        command.env("SNAP_COOKIE", cookie);
    }
    let mut child = command
        .args(["is-connected", plug])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait() {
            // `is-connected` exits 0 when connected and 1 when not.
            Ok(Some(status)) => {
                return match status.code() {
                    Some(0) => Some(true),
                    Some(1) => Some(false),
                    _ => None,
                };
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}
