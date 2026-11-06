use crate::dns;
use crate::killswitch;
use crate::network_manager;
use crate::paths;
use crate::protocol::Mutation;
use crate::recovery::{RecoveryJournal, RecoveryPhase, RecoveryRecord};
use crate::tunnel_config::{ConnectParams, TunnelConfig};
use serde_json::{Value, json};
use std::fs;
use std::io::{self, Read, Write};
use std::net::{IpAddr, ToSocketAddrs, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

// Resolved below the layout's tools root; see `paths::Paths::tool`.
const WG: &str = "usr/bin/wg";
const IP: &str = "usr/bin/ip";
const NFT: &str = "usr/sbin/nft";
const VERIFY_WINDOW: Duration = Duration::from_millis(2500);
const VERIFY_POLL: Duration = Duration::from_millis(250);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(10);
// Below the main-table rule (32766), but after the kernel's local rule (0).
const RULE_PRIORITY: &str = "11000";
const RULE_PROTOCOL: &str = "42";
/// How `ip -N rule show` prints rules added with `protocol 42`.
const RULE_MARKER: &str = " proto 42";
/// WireGuard marks its own encrypted packets with this fwmark; everything
/// else is routed through this table, whose only route is the tunnel.
const FWMARK: &str = "51820";
const ROUTE_TABLE: &str = "51820";
/// Anti-spoofing and connection-mark rules for the full tunnel.
const TUNNEL_TABLE: &str = "k1vpn_tun";
const SRC_VALID_MARK: &str = "/proc/sys/net/ipv4/conf/all/src_valid_mark";

pub struct TunnelError(&'static str, &'static str);

impl TunnelError {
    pub fn code(&self) -> &'static str {
        self.0
    }
    pub fn message(&self) -> &'static str {
        self.1
    }
}

pub struct TunnelManager {
    journal: RecoveryJournal,
    connected_server: Option<String>,
    kill_switch: bool,
    verify_target: Option<IpAddr>,
}

impl TunnelManager {
    pub fn new(journal: RecoveryJournal) -> Self {
        Self {
            journal,
            connected_server: None,
            kill_switch: false,
            verify_target: None,
        }
    }

    /// The in-tunnel address used to provoke traffic for a liveness check.
    pub fn verify_target(&self) -> Option<IpAddr> {
        self.verify_target
    }

    pub fn recovery_required(&self) -> bool {
        self.connected_server.is_none() && self.journal.required().unwrap_or(true)
    }

    /// The tunnel can also be ended outside the service, for example from
    /// the desktop's network menu. Without the kill switch that is an
    /// ordinary disconnect, so the remaining protection is removed. With it,
    /// the kill switch keeps blocking traffic and the session becomes a
    /// recovery case, exactly as if the tunnel had failed.
    fn reconcile(&mut self) {
        if self.connected_server.is_none() || interface_present() {
            return;
        }
        if self.kill_switch {
            eprintln!(
                "k1vpnd: the VPN tunnel was removed outside the service; the kill switch stays"
            );
            self.connected_server = None;
            self.kill_switch = false;
            self.verify_target = None;
        } else {
            eprintln!("k1vpnd: the VPN tunnel was removed outside the service; cleaning up");
            if self.disconnect().is_err() {
                self.connected_server = None;
                self.verify_target = None;
            }
        }
    }

    pub fn status(&mut self) -> Value {
        self.reconcile();
        match &self.connected_server {
            Some(server_id) => {
                let (handshake, rx, tx) = wireguard_stats().unwrap_or((None, None, None));
                json!({
                    "state": "connected",
                    "server_id": server_id,
                    "recovery_required": false,
                    "kill_switch": self.kill_switch,
                    "last_handshake_secs_ago": handshake,
                    "rx_bytes": rx,
                    "tx_bytes": tx
                })
            }
            None => json!({
                "state": "disconnected",
                "server_id": null,
                "recovery_required": self.recovery_required(),
                "kill_switch": false,
                "last_handshake_secs_ago": null,
                "rx_bytes": null,
                "tx_bytes": null
            }),
        }
    }

    pub fn execute(&mut self, mutation: Mutation) -> Result<Value, TunnelError> {
        match mutation {
            Mutation::Connect { params, .. } => self.connect(*params),
            Mutation::Disconnect { .. } | Mutation::Recover { .. } => self.disconnect(),
        }
    }

    /// Takes over a tunnel that an earlier instance of the service left
    /// running: across a refresh (see `shutdown`) or after a crash. Only a
    /// fully established tunnel whose every piece is still present is
    /// adopted; anything else stays a recovery case and fails closed.
    pub fn adopt(&mut self) {
        let Ok(Some(record)) = self.journal.read() else {
            return;
        };
        if record.phase != RecoveryPhase::TunnelCreated || !tunnel_intact(record.kill_switch) {
            return;
        }
        eprintln!("k1vpnd: resumed the VPN tunnel left by the previous service instance");
        self.connected_server = Some(record.server_id);
        self.kill_switch = record.kill_switch;
        self.verify_target = record.verify_target;
    }

    /// snapd stops the service for a refresh, removal, disable or system
    /// shutdown. During a refresh the connected tunnel, its kill switch and
    /// its journal stay in place for the new revision to adopt, so traffic
    /// never leaves the tunnel. Every other stop cleans owned networking. An
    /// idle service must touch no rules.
    pub fn shutdown(&mut self) -> Result<(), TunnelError> {
        if self.connected_server.is_some() && paths::get().refresh_pending() {
            eprintln!("k1vpnd: refresh in progress; leaving the VPN tunnel to the new revision");
            return Ok(());
        }
        if self.connected_server.is_some()
            || interface_present()
            || self.journal.required().map_err(internal)?
        {
            self.disconnect()?;
        }
        Ok(())
    }

    fn connect(&mut self, params: ConnectParams) -> Result<Value, TunnelError> {
        if self.connected_server.is_some() {
            return Err(TunnelError(
                "already_connected",
                "a VPN tunnel is already active",
            ));
        }
        if self.journal.required().unwrap_or(true) {
            return Err(TunnelError(
                "recovery_required",
                "network recovery is required before connecting",
            ));
        }
        let endpoint = resolve_endpoint(&params.config)?;
        let mut record = RecoveryRecord {
            version: 1,
            operation_id: params.operation_id.clone(),
            server_id: params.server_id.clone(),
            phase: RecoveryPhase::Preparing,
            kill_switch: params.protection.kill_switch,
            verify_target: params
                .config
                .dns
                .first()
                .and_then(|address| address.parse().ok()),
        };
        self.journal.write(&record).map_err(internal)?;

        if let Err(error) = set_family_block(&params.config, true) {
            let _ = self.journal.clear();
            return Err(error);
        }
        if params.protection.kill_switch
            && let Err(error) = apply_kill_switch(
                endpoint,
                params.config.endpoint_port,
                params.protection.allow_local_network,
            )
        {
            let family_ok = set_family_block(&params.config, false).is_ok();
            let switch_ok = remove_kill_switch().is_ok();
            if family_ok && switch_ok {
                let _ = self.journal.clear();
            }
            return Err(error);
        }
        record.phase = RecoveryPhase::FirewallApplied;
        self.journal.write(&record).map_err(internal)?;

        if let Err(error) = tunnel_up(&params.config, endpoint) {
            let cleanup_ok = tunnel_down().is_ok();
            let family_ok = set_family_block(&params.config, false).is_ok();
            let switch_ok = remove_kill_switch().is_ok();
            if cleanup_ok && family_ok && switch_ok {
                let _ = self.journal.clear();
            }
            return Err(error);
        }
        record.phase = RecoveryPhase::TunnelCreated;
        self.journal.write(&record).map_err(internal)?;
        self.connected_server = Some(params.server_id.clone());
        self.kill_switch = record.kill_switch;
        self.verify_target = record.verify_target;
        Ok(json!({ "state": "connected", "server_id": params.server_id }))
    }

    fn disconnect(&mut self) -> Result<Value, TunnelError> {
        self.journal.begin_disconnect().map_err(internal)?;
        // Every step checks what is actually present, so recovery after a
        // crash, refresh or reboot is the same idempotent cleanup.
        let down = tunnel_down();
        let unblock = remove_both_family_blocks();
        let switch = remove_kill_switch();
        if down.is_err() || unblock.is_err() || switch.is_err() {
            return Err(TunnelError(
                "cleanup_failed",
                "the VPN could not safely restore networking",
            ));
        }
        self.journal.clear().map_err(internal)?;
        self.connected_server = None;
        self.kill_switch = false;
        self.verify_target = None;
        Ok(json!({ "state": "disconnected" }))
    }
}

fn interface_present() -> bool {
    probe(IP, &["link", "show", "dev", killswitch::INTERFACE])
}

fn tunnel_intact(kill_switch: bool) -> bool {
    let routed = ["-4", "-6"].iter().any(|selector| {
        rules(selector).is_ok_and(|rules| {
            // Ours (protocol 42) or NetworkManager's: either routes all
            // unmarked traffic through the tunnel's table.
            rules.lines().any(|line| {
                line.contains("fwmark") && line.contains(&format!("lookup {ROUTE_TABLE}"))
            })
        })
    });
    interface_present()
        && routed
        && (!kill_switch || probe(NFT, &["list", "table", "inet", killswitch::TABLE]))
}

/// Brings up the full tunnel. Where NetworkManager is available it owns the
/// connection, so the desktop shows it as a VPN; otherwise the service
/// creates it itself. Either way the firewall table below is ours. On error
/// the caller runs `tunnel_down`.
fn tunnel_up(config: &TunnelConfig, endpoint: IpAddr) -> Result<(), TunnelError> {
    let mtu = tunnel_mtu(endpoint);
    let address: IpAddr = config.address.parse().map_err(|_| internal_failure())?;
    let fwmark: u32 = FWMARK.parse().map_err(|_| internal_failure())?;
    let managed = network_manager::Tunnel {
        interface: killswitch::INTERFACE,
        private_key: Zeroizing::new(config.private_key.clone()),
        peer_public_key: config.peer_public_key.clone(),
        endpoint: endpoint_text(endpoint, config.endpoint_port),
        allowed_ips: config.allowed_ips.clone(),
        persistent_keepalive: config.persistent_keepalive,
        fwmark,
        mtu,
        address,
        dns: config.dns.clone(),
    };
    match network_manager::activate(managed) {
        Ok(()) => {}
        Err(network_manager::ActivationError::Failed) => return Err(internal_failure()),
        Err(network_manager::ActivationError::Unavailable) => {
            create_tunnel(config, endpoint, mtu)?;
        }
    }
    if config.address_family == 4 {
        // Replies to the fwmark-routed tunnel packets need a valid source.
        fs::write(SRC_VALID_MARK, "1").map_err(internal)?;
    }
    run_with_input(
        NFT,
        &["-f", "-"],
        tunnel_ruleset(config.address_family, &config.address).as_bytes(),
    )
}

fn endpoint_text(endpoint: IpAddr, port: u16) -> String {
    if endpoint.is_ipv6() {
        format!("[{endpoint}]:{port}")
    } else {
        format!("{endpoint}:{port}")
    }
}

/// The tunnel without NetworkManager, in the order wg-quick uses. The
/// private key reaches WireGuard only through a pipe, never a file, and
/// NetworkManager (if present but not ours to use) is told to leave the
/// interface alone before it has an address.
fn create_tunnel(config: &TunnelConfig, endpoint: IpAddr, mtu: u32) -> Result<(), TunnelError> {
    let interface = killswitch::INTERFACE;
    run(IP, &["link", "add", "dev", interface, "type", "wireguard"])?;
    network_manager::unmanage(interface);
    let settings = wireguard_settings(config, endpoint);
    run_with_input(
        WG,
        &["setconf", interface, "/dev/stdin"],
        settings.as_bytes(),
    )?;
    drop(settings);

    let (selector, prefix, default_route) = if config.address_family == 4 {
        ("-4", 32, "0.0.0.0/0")
    } else {
        ("-6", 128, "::/0")
    };
    let address = format!("{}/{prefix}", config.address);
    run(
        IP,
        &[selector, "address", "add", &address, "dev", interface],
    )?;
    let mtu = mtu.to_string();
    run(IP, &["link", "set", "mtu", &mtu, "up", "dev", interface])?;

    let index = nix::net::if_::if_nametoindex(interface).map_err(|_| internal_failure())?;
    let servers: Vec<IpAddr> = config
        .dns
        .iter()
        .filter_map(|address| address.parse().ok())
        .collect();
    dns::apply(index, &servers).map_err(|()| internal_failure())?;

    // The validated configuration always contains a default route; narrower
    // AllowedIPs are already covered by it and only matter to WireGuard.
    run(
        IP,
        &[
            selector,
            "rule",
            "add",
            "not",
            "fwmark",
            FWMARK,
            "table",
            ROUTE_TABLE,
            "protocol",
            RULE_PROTOCOL,
        ],
    )?;
    run(
        IP,
        &[
            selector,
            "rule",
            "add",
            "table",
            "main",
            "suppress_prefixlength",
            "0",
            "protocol",
            RULE_PROTOCOL,
        ],
    )?;
    run(
        IP,
        &[
            selector,
            "route",
            "add",
            default_route,
            "dev",
            interface,
            "table",
            ROUTE_TABLE,
        ],
    )
}

/// WireGuard's own settings; addresses, DNS and routes are applied above.
fn wireguard_settings(config: &TunnelConfig, endpoint: IpAddr) -> Zeroizing<String> {
    let endpoint = endpoint_text(endpoint, config.endpoint_port);
    let mut text = Zeroizing::new(String::with_capacity(512));
    text.push_str("[Interface]\nPrivateKey = ");
    text.push_str(&config.private_key);
    text.push_str(&format!(
        "\nFwMark = {FWMARK}\n\n[Peer]\nPublicKey = {}\nEndpoint = {endpoint}\nAllowedIPs = {}\n",
        config.peer_public_key,
        config.allowed_ips.join(", ")
    ));
    if let Some(keepalive) = config.persistent_keepalive {
        text.push_str(&format!("PersistentKeepalive = {keepalive}\n"));
    }
    text
}

/// The same rules wg-quick installs for a full tunnel: drop packets for the
/// tunnel address that arrive on another interface, and carry the fwmark on
/// the connection so replies to tunnel packets are routed correctly.
fn tunnel_ruleset(family: u8, address: &str) -> String {
    let (table_family, selector) = if family == 4 {
        ("ip", "ip")
    } else {
        ("ip6", "ip6")
    };
    let interface = killswitch::INTERFACE;
    format!(
        "table {table_family} {TUNNEL_TABLE} {{\n    chain preraw {{\n        type filter hook prerouting priority -300;\n        iifname != \"{interface}\" {selector} daddr {address} fib saddr type != local drop\n    }}\n    chain premangle {{\n        type filter hook prerouting priority -150;\n        meta l4proto udp meta mark set ct mark\n    }}\n    chain postmangle {{\n        type filter hook postrouting priority -150;\n        meta l4proto udp mark {FWMARK} ct mark set mark\n    }}\n}}\n"
    )
}

/// wg-quick's choice: 80 bytes below the MTU of the path to the endpoint.
fn tunnel_mtu(endpoint: IpAddr) -> u32 {
    let route = command_output(IP, &["route", "get", &endpoint.to_string()]).unwrap_or_default();
    let route = String::from_utf8_lossy(&route);
    let path_mtu = word_after(&route, "mtu")
        .and_then(|value| value.parse::<u32>().ok())
        .or_else(|| {
            let device = word_after(&route, "dev").filter(|name| {
                name.len() <= 15
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })?;
            let link = command_output(IP, &["link", "show", "dev", device]).ok()?;
            word_after(&String::from_utf8_lossy(&link), "mtu")?
                .parse::<u32>()
                .ok()
        })
        .unwrap_or(1500);
    path_mtu.saturating_sub(80).clamp(1280, 9000)
}

fn word_after<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let mut words = text.split_whitespace();
    words.find(|word| *word == key)?;
    words.next()
}

/// Removes everything `tunnel_up` may have added, whatever step it reached.
/// The interface going away also drops its routes and its resolver settings.
fn tunnel_down() -> Result<(), TunnelError> {
    // Through NetworkManager first, so the desktop records a user disconnect;
    // anything left over is removed directly below.
    network_manager::deactivate(killswitch::INTERFACE);
    let rules = ["-4", "-6"].map(remove_tunnel_rules);
    let tables = ["ip", "ip6"].map(|family| remove_nft_table(family, TUNNEL_TABLE));
    let link = if interface_present() {
        run(IP, &["link", "delete", "dev", killswitch::INTERFACE])
    } else {
        Ok(())
    };
    if rules.iter().chain(&tables).all(Result::is_ok) && link.is_ok() {
        Ok(())
    } else {
        Err(TunnelError(
            "cleanup_failed",
            "network recovery could not remove the tunnel",
        ))
    }
}

fn remove_tunnel_rules(selector: &str) -> Result<(), TunnelError> {
    for rule in [
        &["table", ROUTE_TABLE][..],
        &["table", "main", "suppress_prefixlength", "0"],
    ] {
        let mut arguments = vec![selector, "rule", "del"];
        arguments.extend_from_slice(rule);
        arguments.extend_from_slice(&["protocol", RULE_PROTOCOL]);
        // Bounded: each pass removes one copy of the rule.
        for _ in 0..8 {
            if !probe(IP, &arguments) {
                break;
            }
        }
    }
    let present = rules(selector)?.lines().any(|line| {
        line.contains(RULE_MARKER)
            && (line.contains(&format!("lookup {ROUTE_TABLE}"))
                || line.contains("suppress_prefixlength 0"))
    });
    if present {
        Err(TunnelError(
            "cleanup_failed",
            "network recovery could not remove the tunnel routing",
        ))
    } else {
        Ok(())
    }
}

fn command(program: &str) -> Command {
    let paths = paths::get();
    let mut command = Command::new(paths.tool(program));
    command
        .env_clear()
        .env("PATH", paths.child_path())
        .env("LANG", "C");
    if let Some(libraries) = paths.child_library_path() {
        command.env("LD_LIBRARY_PATH", libraries);
    }
    command
}

fn internal_failure() -> TunnelError {
    internal(io::Error::other("tunnel setup failed"))
}

fn internal(_error: io::Error) -> TunnelError {
    TunnelError(
        "network_operation_failed",
        "the privileged networking operation failed",
    )
}

fn resolve_endpoint(config: &TunnelConfig) -> Result<IpAddr, TunnelError> {
    let host = config.endpoint_host.clone();
    let port = config.endpoint_port;
    let ipv4 = config.address_family == 4;
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let result = (host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| choose_endpoint(addresses.map(|address| address.ip()), ipv4));
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(RESOLUTION_TIMEOUT) {
        Ok(Ok(Some(address))) => Ok(address),
        _ => Err(TunnelError(
            "endpoint_unreachable",
            "the VPN endpoint could not be resolved",
        )),
    }
}

fn choose_endpoint(addresses: impl Iterator<Item = IpAddr>, prefer_ipv4: bool) -> Option<IpAddr> {
    let mut fallback = None;
    for address in addresses {
        fallback.get_or_insert(address);
        if address.is_ipv4() == prefer_ipv4 {
            return Some(address);
        }
    }
    fallback
}

fn set_family_block(config: &TunnelConfig, add: bool) -> Result<(), TunnelError> {
    let family = if config.block_ipv4 { 4 } else { 6 };
    if add {
        add_family_block(family)
    } else {
        remove_family_block(family)
    }
}

fn add_family_block(family: u8) -> Result<(), TunnelError> {
    run(IP, &family_block_arguments(family))
}

fn family_block_arguments(family: u8) -> [&'static str; 12] {
    // The assigned tunnel family and the endpoint's transport family may
    // differ. WireGuard's marked encrypted packets must still reach the
    // physical default route in the otherwise blocked family.
    [
        if family == 4 { "-4" } else { "-6" },
        "rule",
        "add",
        "priority",
        RULE_PRIORITY,
        "protocol",
        RULE_PROTOCOL,
        "not",
        "fwmark",
        FWMARK,
        "type",
        "prohibit",
    ]
}

fn remove_family_block(family: u8) -> Result<(), TunnelError> {
    let selector = if family == 4 { "-4" } else { "-6" };
    if probe(
        IP,
        &[
            selector,
            "rule",
            "del",
            "priority",
            RULE_PRIORITY,
            "protocol",
            RULE_PROTOCOL,
            "type",
            "prohibit",
        ],
    ) {
        return Ok(());
    }
    if rule_present(selector)? {
        Err(TunnelError(
            "cleanup_failed",
            "network recovery could not remove the traffic block",
        ))
    } else {
        Ok(())
    }
}

fn remove_both_family_blocks() -> Result<(), TunnelError> {
    let v4 = remove_family_block(4);
    let v6 = remove_family_block(6);
    if v4.is_ok() && v6.is_ok() {
        Ok(())
    } else {
        Err(TunnelError(
            "cleanup_failed",
            "network recovery could not remove the traffic block",
        ))
    }
}

fn rules(selector: &str) -> Result<String, TunnelError> {
    // -N prints protocol numbers: distributions name 42 differently ("babel").
    command_output(IP, &["-N", selector, "rule", "show"])
        .map(|output| String::from_utf8_lossy(&output).into_owned())
        .map_err(|_| {
            TunnelError(
                "cleanup_failed",
                "network recovery could not inspect the routing rules",
            )
        })
}

fn rule_present(selector: &str) -> Result<bool, TunnelError> {
    let marker = format!("{RULE_PRIORITY}:");
    Ok(rules(selector)?.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with(&marker) && line.contains("prohibit") && line.contains(RULE_MARKER)
    }))
}

fn apply_kill_switch(
    endpoint: IpAddr,
    port: u16,
    allow_local_network: bool,
) -> Result<(), TunnelError> {
    let ruleset = killswitch::ruleset(endpoint, port, allow_local_network);
    run_with_input(NFT, &["-f", "-"], ruleset.as_bytes())
}

fn remove_kill_switch() -> Result<(), TunnelError> {
    remove_nft_table("inet", killswitch::TABLE)
}

fn remove_nft_table(family: &str, table: &str) -> Result<(), TunnelError> {
    if probe(NFT, &["delete", "table", family, table]) {
        return Ok(());
    }
    // A failed delete is acceptable only when the table is genuinely absent.
    let tables = command_output(NFT, &["list", "tables"]).map_err(internal)?;
    if nft_table_present(&tables, family, table).map_err(internal)? {
        Err(TunnelError(
            "cleanup_failed",
            "network recovery could not remove a firewall table",
        ))
    } else {
        Ok(())
    }
}

fn nft_table_present(output: &[u8], family: &str, table: &str) -> io::Result<bool> {
    let text = std::str::from_utf8(output)
        .map_err(|_| io::Error::other("invalid firewall table listing"))?;
    let mut present = false;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 3 || fields[0] != "table" {
            return Err(io::Error::other("invalid firewall table listing"));
        }
        present |= fields[1] == family && fields[2] == table;
    }
    Ok(present)
}

fn command_output(program: &str, arguments: &[&str]) -> io::Result<Vec<u8>> {
    let output = command(program)
        .args(arguments)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    if !output.status.success() || output.stdout.len() > 64 * 1024 {
        return Err(io::Error::other("status command failed"));
    }
    Ok(output.stdout)
}

/// Latest handshake (Unix seconds), received bytes and sent bytes.
fn wireguard_counters() -> io::Result<(Option<u64>, Option<u64>, Option<u64>)> {
    let handshake_output = command_output(WG, &["show", "k1vpn0", "latest-handshakes"])?;
    let transfer_output = command_output(WG, &["show", "k1vpn0", "transfer"])?;
    let handshake_epoch = String::from_utf8_lossy(&handshake_output)
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let transfer_text = String::from_utf8_lossy(&transfer_output);
    let mut transfer = transfer_text.split_whitespace().skip(1);
    let rx = transfer.next().and_then(|value| value.parse::<u64>().ok());
    let tx = transfer.next().and_then(|value| value.parse::<u64>().ok());
    Ok((handshake_epoch, rx, tx))
}

/// Peer-level liveness check: provokes a tiny packet through the tunnel and
/// reports whether WireGuard saw a newer handshake or more received bytes.
/// This proves the peer answers, not that the upstream internet works.
pub fn verify_tunnel(target: Option<IpAddr>) -> Value {
    let Some(target) = target else {
        return json!({ "outcome": "no_tunnel" });
    };
    let Ok((handshake_before, rx_before, _)) = wireguard_counters() else {
        return json!({ "outcome": "local_error" });
    };
    stimulate(target);
    let deadline = Instant::now() + VERIFY_WINDOW;
    loop {
        thread::sleep(VERIFY_POLL);
        let Ok((handshake, rx, _)) = wireguard_counters() else {
            return json!({ "outcome": "local_error" });
        };
        if handshake > handshake_before || rx > rx_before {
            return json!({ "outcome": "verified" });
        }
        if Instant::now() >= deadline {
            return json!({ "outcome": "inconclusive" });
        }
    }
}

fn stimulate(target: IpAddr) {
    let bind = if target.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    // A root-name NS query to the tunnel resolver; the reply, or the handshake
    // the packet forces, is what the counters observe.
    const QUERY: [u8; 17] = [
        0x4b, 0x31, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0x00, 0x00, 0x02, 0x00, 0x01,
    ];
    if let Ok(socket) = UdpSocket::bind(bind) {
        let _ = socket.send_to(&QUERY, (target, 53));
    }
}

fn wireguard_stats() -> io::Result<(Option<u64>, Option<u64>, Option<u64>)> {
    let (handshake_epoch, rx, tx) = wireguard_counters()?;
    let handshake_age = handshake_epoch.map(|epoch| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .saturating_sub(epoch)
    });
    Ok((handshake_age, rx, tx))
}

fn run(program: &str, arguments: &[&str]) -> Result<(), TunnelError> {
    run_command(program, arguments, &[], true)
}

fn run_with_input(program: &str, arguments: &[&str], input: &[u8]) -> Result<(), TunnelError> {
    run_command(program, arguments, input, true)
}

/// For cleanup steps whose failure is expected when nothing is left to
/// remove; the caller decides, so the journal stays free of false alarms.
fn probe(program: &str, arguments: &[&str]) -> bool {
    run_command(program, arguments, &[], false).is_ok()
}

const MAX_LOGGED_STDERR: usize = 1024;

/// Writes a failed command to the journal: arguments and a bounded,
/// printable excerpt of stderr. Never stdin or the configuration file, which
/// hold key material. Clients still receive only the generic error.
fn log_failure(program: &str, arguments: &[&str], outcome: &str, stderr: &[u8]) {
    eprintln!("{}", failure_line(program, arguments, outcome, stderr));
}

fn failure_line(program: &str, arguments: &[&str], outcome: &str, stderr: &[u8]) -> String {
    let excerpt: String = String::from_utf8_lossy(&stderr[..stderr.len().min(MAX_LOGGED_STDERR)])
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" | ")
        .chars()
        .map(|character| {
            if character.is_control() {
                '?'
            } else {
                character
            }
        })
        .collect();
    format!(
        "k1vpnd: {program} {} {outcome}: {excerpt}",
        arguments.join(" ")
    )
}

fn run_command(
    program: &str,
    arguments: &[&str],
    input: &[u8],
    log: bool,
) -> Result<(), TunnelError> {
    let mut child = command(program)
        .args(arguments)
        .stdin(if input.is_empty() {
            Stdio::null()
        } else {
            Stdio::piped()
        })
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(internal)?;
    // Drained on its own thread so a chatty command cannot block on a full
    // pipe while this thread waits for it.
    let stderr = child.stderr.take();
    let reader = thread::spawn(move || {
        let mut excerpt = Vec::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr
                .by_ref()
                .take(MAX_LOGGED_STDERR as u64)
                .read_to_end(&mut excerpt);
            let _ = io::copy(&mut stderr, &mut io::sink());
        }
        excerpt
    });
    let report = |outcome: &str, reader: thread::JoinHandle<Vec<u8>>| {
        let stderr = reader.join().unwrap_or_default();
        if log {
            log_failure(program, arguments, outcome, &stderr);
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        // The ruleset is small enough to fit the pipe buffer; closing stdin
        // on drop lets the command read to the end.
        if stdin.write_all(input).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            report("did not accept its input", reader);
            return Err(TunnelError(
                "network_operation_failed",
                "the Linux networking backend rejected the operation",
            ));
        }
    }
    let deadline = Instant::now() + COMMAND_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                report(&format!("failed ({status})"), reader);
                return Err(TunnelError(
                    "network_operation_failed",
                    "the Linux networking backend rejected the operation",
                ));
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                report("timed out", reader);
                return Err(TunnelError(
                    "network_operation_timeout",
                    "the Linux networking operation timed out",
                ));
            }
            Err(error) => return Err(internal(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(family: u8) -> TunnelConfig {
        let key = |byte: u8| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, [byte; 32])
        };
        TunnelConfig {
            private_key: key(1),
            address: if family == 4 { "10.8.0.2" } else { "fd00::2" }.into(),
            address_family: family,
            peer_public_key: key(2),
            endpoint_host: "vpn.example.com".into(),
            endpoint_port: 51820,
            allowed_ips: vec![if family == 4 { "0.0.0.0/0" } else { "::/0" }.into()],
            dns: vec![if family == 4 { "10.8.0.1" } else { "fd00::1" }.into()],
            persistent_keepalive: Some(25),
            block_ipv4: family == 6,
            block_ipv6: family == 4,
        }
    }

    #[test]
    fn wireguard_receives_only_its_own_settings_with_the_tunnel_fwmark() {
        let config = config(4);
        let text = wireguard_settings(&config, "203.0.113.9".parse().unwrap());
        assert!(text.contains(&format!("PrivateKey = {}\n", config.private_key)));
        assert!(text.contains("FwMark = 51820\n"));
        assert!(text.contains("Endpoint = 203.0.113.9:51820\n"));
        assert!(text.contains("AllowedIPs = 0.0.0.0/0\n"));
        assert!(text.contains("PersistentKeepalive = 25\n"));
        // wg setconf rejects wg-quick-only keys.
        assert!(!text.contains("Address") && !text.contains("DNS"));
        let ipv6 = wireguard_settings(&config, "2001:db8::1".parse().unwrap());
        assert!(ipv6.contains("Endpoint = [2001:db8::1]:51820\n"));
    }

    #[test]
    fn tunnel_ruleset_matches_the_address_family() {
        let ipv4 = tunnel_ruleset(4, "10.8.0.2");
        assert!(ipv4.starts_with("table ip k1vpn_tun {"));
        assert!(
            ipv4.contains("iifname != \"k1vpn0\" ip daddr 10.8.0.2 fib saddr type != local drop")
        );
        assert!(ipv4.contains("mark 51820 ct mark set mark"));
        let ipv6 = tunnel_ruleset(6, "fd00::2");
        assert!(ipv6.starts_with("table ip6 k1vpn_tun {"));
        assert!(ipv6.contains("ip6 daddr fd00::2"));
    }

    #[test]
    fn reads_values_from_ip_output() {
        let route =
            "203.0.113.9 via 192.168.1.1 dev wlp2s0 src 192.168.1.5 uid 0 \n    cache mtu 1492";
        assert_eq!(word_after(route, "dev"), Some("wlp2s0"));
        assert_eq!(word_after(route, "mtu"), Some("1492"));
        assert_eq!(word_after(route, "table"), None);
    }

    #[test]
    fn unsupported_family_blocks_exempt_only_wireguard_marked_transport() {
        for family in [4, 6] {
            let args = family_block_arguments(family);
            assert_eq!(args[0], if family == 4 { "-4" } else { "-6" });
            assert!(
                args.windows(3)
                    .any(|part| part == ["not", "fwmark", FWMARK])
            );
            assert!(args.windows(2).any(|part| part == ["type", "prohibit"]));
        }
    }

    #[test]
    fn endpoints_can_use_a_different_transport_family_from_the_tunnel() {
        let v4: IpAddr = "203.0.113.9".parse().unwrap();
        let v6: IpAddr = "2001:db8::1".parse().unwrap();
        assert_eq!(choose_endpoint([v6].into_iter(), true), Some(v6));
        assert_eq!(choose_endpoint([v4].into_iter(), false), Some(v4));
        assert_eq!(choose_endpoint([v6, v4].into_iter(), true), Some(v4));
        assert_eq!(choose_endpoint([v4, v6].into_iter(), false), Some(v6));
    }

    #[test]
    fn firewall_cleanup_requires_a_valid_listing_to_confirm_absence() {
        let tables = b"table inet other\ntable ip k1vpn_ks\ntable inet k1vpn_ks_extra\n";
        assert!(!nft_table_present(tables, "inet", "k1vpn_ks").unwrap());
        assert!(nft_table_present(b"table inet k1vpn_ks\n", "inet", "k1vpn_ks").unwrap());
        assert!(!nft_table_present(b"", "inet", "k1vpn_ks").unwrap());
        assert!(nft_table_present(b"Operation not permitted", "inet", "k1vpn_ks").is_err());
    }

    #[test]
    fn failure_lines_are_single_line_bounded_and_printable() {
        let mut stderr = b"Error: bad rule\n\n\x1b[31mred\x1b[0m\n".to_vec();
        stderr.extend(std::iter::repeat_n(b'x', 4 * MAX_LOGGED_STDERR));
        let line = failure_line(
            IP,
            &["-6", "rule", "add"],
            "failed (exit status: 2)",
            &stderr,
        );
        assert!(line.starts_with(
            "k1vpnd: usr/bin/ip -6 rule add failed (exit status: 2): Error: bad rule | ?[31mred?[0m | x"
        ));
        assert!(!line.contains('\n'));
        assert!(line.len() < MAX_LOGGED_STDERR + 128);
    }
}
