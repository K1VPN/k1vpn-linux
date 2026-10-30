use std::net::IpAddr;

pub const TABLE: &str = "k1vpn_ks";
pub const INTERFACE: &str = "k1vpn0";

const LOCAL_V4: &str = "{ 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 224.0.0.0/4 }";
const LOCAL_V6: &str = "{ fe80::/10, fc00::/7, ff00::/8 }";
const NEIGHBOR_DISCOVERY: &str =
    "{ nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert }";

/// Complete nftables ruleset for the kill switch. Everything that is not the
/// tunnel interface, loopback, the single VPN endpoint, address configuration
/// or (optionally) the local network is dropped in both directions.
pub fn ruleset(endpoint: IpAddr, port: u16, allow_local_network: bool) -> String {
    let endpoint_rule = match endpoint {
        IpAddr::V4(address) => format!("ip daddr {address} udp dport {port} accept"),
        IpAddr::V6(address) => format!("ip6 daddr {address} udp dport {port} accept"),
    };
    let mut output = vec![
        "oifname \"lo\" accept".to_owned(),
        format!("oifname \"{INTERFACE}\" accept"),
        endpoint_rule,
        "udp sport 68 udp dport 67 accept".to_owned(),
        "udp sport 546 udp dport 547 accept".to_owned(),
        format!("icmpv6 type {NEIGHBOR_DISCOVERY} accept"),
    ];
    let mut input = vec![
        "iifname \"lo\" accept".to_owned(),
        format!("iifname \"{INTERFACE}\" accept"),
        "ct state established,related accept".to_owned(),
        "udp sport 67 udp dport 68 accept".to_owned(),
        "udp sport 547 udp dport 546 accept".to_owned(),
        format!("icmpv6 type {NEIGHBOR_DISCOVERY} accept"),
    ];
    if allow_local_network {
        output.push(format!("ip daddr {LOCAL_V4} accept"));
        output.push(format!("ip6 daddr {LOCAL_V6} accept"));
        input.push(format!("ip saddr {LOCAL_V4} accept"));
        input.push(format!("ip6 saddr {LOCAL_V6} accept"));
    }
    let indent = |rules: &[String]| {
        rules
            .iter()
            .map(|rule| format!("        {rule}\n"))
            .collect::<String>()
    };
    format!(
        "table inet {TABLE} {{\n    chain output {{\n        type filter hook output priority -100; policy drop;\n{}    }}\n    chain input {{\n        type filter hook input priority -100; policy drop;\n{}    }}\n}}\n",
        indent(&output),
        indent(&input)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_by_default_and_allows_only_the_endpoint_and_tunnel() {
        let text = ruleset("203.0.113.9".parse().unwrap(), 51820, false);
        assert_eq!(text.matches("policy drop;").count(), 2);
        assert!(text.contains("ip daddr 203.0.113.9 udp dport 51820 accept"));
        assert!(text.contains("oifname \"k1vpn0\" accept"));
        assert!(!text.contains("192.168.0.0/16"));
    }

    #[test]
    fn local_network_exception_is_opt_in_and_symmetric() {
        let text = ruleset("203.0.113.9".parse().unwrap(), 51820, true);
        assert!(text.contains("ip daddr { 10.0.0.0/8"));
        assert!(text.contains("ip saddr { 10.0.0.0/8"));
        assert!(text.contains("ip6 daddr { fe80::/10"));
        assert!(text.contains("ip6 saddr { fe80::/10"));
    }

    #[test]
    fn ipv6_endpoints_use_the_ipv6_selector() {
        let text = ruleset("2001:db8::1".parse().unwrap(), 51820, false);
        assert!(text.contains("ip6 daddr 2001:db8::1 udp dport 51820 accept"));
    }

    #[test]
    fn existing_cleartext_connections_cannot_bypass_the_output_kill_switch() {
        let text = ruleset("203.0.113.9".parse().unwrap(), 51820, false);
        let output = text.split("chain input").next().unwrap();
        // A browser connection opened before the VPN must be dropped too
        // when the tunnel disappears; conntrack alone cannot authorize it.
        assert!(!output.contains("ct state established,related accept"));
        assert!(output.contains("policy drop;"));
        assert!(output.contains("oifname \"k1vpn0\" accept"));
        assert!(output.contains("ip daddr 203.0.113.9 udp dport 51820 accept"));
    }
}
