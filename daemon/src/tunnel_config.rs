use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::net::IpAddr;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectParams {
    pub operation_id: String,
    pub server_id: String,
    pub config: TunnelConfig,
    #[serde(default)]
    pub protection: Protection,
}

#[derive(Debug, Default, Deserialize, Zeroize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Protection {
    pub kill_switch: bool,
    pub allow_local_network: bool,
}

#[derive(Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TunnelConfig {
    pub private_key: String,
    pub address: String,
    pub address_family: u8,
    pub peer_public_key: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub allowed_ips: Vec<String>,
    pub dns: Vec<String>,
    pub persistent_keepalive: Option<u16>,
    pub block_ipv4: bool,
    pub block_ipv6: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    InvalidEnvelope,
    InvalidKey,
    InvalidAddress,
    InvalidEndpoint,
    InvalidRoute,
    NoFullTunnel,
    InvalidDns,
    UnsafeFamilyPolicy,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn wireguard_key(value: &str) -> bool {
    value.len() == 44
        && STANDARD
            .decode(value)
            .is_ok_and(|decoded| decoded.len() == 32 && STANDARD.encode(decoded) == value)
}

fn endpoint_host(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 || value.contains(['\0', '\r', '\n', '[', ']', ':']) {
        return value
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_ipv6());
    }
    if value.parse::<IpAddr>().is_ok() {
        return true;
    }
    value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && !label.starts_with('-')
            && !label.ends_with('-')
    })
}

#[derive(Clone, Copy)]
struct Route {
    address: IpAddr,
    prefix: u8,
}

fn parse_route(value: &str) -> Option<Route> {
    if value.len() > 128 {
        return None;
    }
    let (address, prefix) = value.split_once('/')?;
    let address = address.parse::<IpAddr>().ok()?;
    let prefix = prefix.parse::<u8>().ok()?;
    if prefix > if address.is_ipv4() { 32 } else { 128 } {
        return None;
    }
    Some(Route { address, prefix })
}

fn route_contains(route: Route, address: IpAddr) -> bool {
    match (route.address, address) {
        (IpAddr::V4(network), IpAddr::V4(candidate)) => {
            let mask = if route.prefix == 0 {
                0
            } else {
                u32::MAX << (32 - route.prefix)
            };
            u32::from(network) & mask == u32::from(candidate) & mask
        }
        (IpAddr::V6(network), IpAddr::V6(candidate)) => {
            let mask = if route.prefix == 0 {
                0
            } else {
                u128::MAX << (128 - route.prefix)
            };
            u128::from(network) & mask == u128::from(candidate) & mask
        }
        _ => false,
    }
}

fn usable_dns(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(value) => {
            let octets = value.octets();
            !(value.is_unspecified()
                || value.is_loopback()
                || value.is_multicast()
                || value.is_broadcast()
                || (octets[0] == 169 && octets[1] == 254))
        }
        IpAddr::V6(value) => {
            !(value.is_unspecified()
                || value.is_loopback()
                || value.is_multicast()
                || value.is_unicast_link_local()
                || value.to_ipv4_mapped().is_some())
        }
    }
}

impl ConnectParams {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if !identifier(&self.operation_id) || !identifier(&self.server_id) {
            return Err(ConfigError::InvalidEnvelope);
        }
        self.config.validate()
    }
}

impl TunnelConfig {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if !wireguard_key(&self.private_key) || !wireguard_key(&self.peer_public_key) {
            return Err(ConfigError::InvalidKey);
        }
        let address = self
            .address
            .parse::<IpAddr>()
            .map_err(|_| ConfigError::InvalidAddress)?;
        if self.address_family != if address.is_ipv4() { 4 } else { 6 } {
            return Err(ConfigError::InvalidAddress);
        }
        if self.endpoint_port == 0 || !endpoint_host(&self.endpoint_host) {
            return Err(ConfigError::InvalidEndpoint);
        }
        if self.allowed_ips.is_empty() || self.allowed_ips.len() > 32 {
            return Err(ConfigError::InvalidRoute);
        }
        let routes = self
            .allowed_ips
            .iter()
            .map(|value| parse_route(value).ok_or(ConfigError::InvalidRoute))
            .collect::<Result<Vec<_>, _>>()?;
        if routes
            .iter()
            .any(|route| route.address.is_ipv4() != address.is_ipv4())
        {
            return Err(ConfigError::InvalidRoute);
        }
        if !routes.iter().any(|route| route.prefix == 0) {
            return Err(ConfigError::NoFullTunnel);
        }
        if self.dns.is_empty() || self.dns.len() > 8 {
            return Err(ConfigError::InvalidDns);
        }
        for raw in &self.dns {
            let dns = raw.parse::<IpAddr>().map_err(|_| ConfigError::InvalidDns)?;
            if !usable_dns(dns) || !routes.iter().any(|route| route_contains(*route, dns)) {
                return Err(ConfigError::InvalidDns);
            }
        }
        let correct_blocks = if address.is_ipv4() {
            !self.block_ipv4 && self.block_ipv6
        } else {
            self.block_ipv4 && !self.block_ipv6
        };
        if !correct_blocks {
            return Err(ConfigError::UnsafeFamilyPolicy);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> String {
        STANDARD.encode([seed; 32])
    }

    fn valid() -> ConnectParams {
        ConnectParams {
            operation_id: "operation-1".into(),
            server_id: "gr-athens-1".into(),
            protection: Protection::default(),
            config: TunnelConfig {
                private_key: key(1),
                address: "10.8.0.2".into(),
                address_family: 4,
                peer_public_key: key(2),
                endpoint_host: "vpn.example.com".into(),
                endpoint_port: 51820,
                allowed_ips: vec!["0.0.0.0/0".into()],
                dns: vec!["1.1.1.1".into()],
                persistent_keepalive: Some(25),
                block_ipv4: false,
                block_ipv6: true,
            },
        }
    }

    #[test]
    fn accepts_a_bounded_full_tunnel() {
        valid().validate().unwrap();
    }

    #[test]
    fn rejects_noncanonical_keys_and_identity_mismatch() {
        let mut value = valid();
        value.config.private_key = "bad".into();
        assert_eq!(value.validate(), Err(ConfigError::InvalidKey));
        value = valid();
        value.config.address_family = 6;
        assert_eq!(value.validate(), Err(ConfigError::InvalidAddress));
    }

    #[test]
    fn rejects_split_or_cross_family_routes_and_dns_leaks() {
        let mut value = valid();
        value.config.allowed_ips = vec!["0.0.0.0/1".into(), "128.0.0.0/1".into()];
        assert_eq!(value.validate(), Err(ConfigError::NoFullTunnel));
        value = valid();
        value.config.allowed_ips.push("::/0".into());
        assert_eq!(value.validate(), Err(ConfigError::InvalidRoute));
        value = valid();
        value.config.dns = vec!["::1".into()];
        assert_eq!(value.validate(), Err(ConfigError::InvalidDns));
    }

    #[test]
    fn requires_explicit_blocking_of_the_unsupported_family() {
        let mut value = valid();
        value.config.block_ipv6 = false;
        assert_eq!(value.validate(), Err(ConfigError::UnsafeFamilyPolicy));
    }

    #[test]
    fn accepts_ipv6_endpoints_for_an_ipv4_tunnel() {
        let mut value = valid();
        value.config.endpoint_host = "2001:db8::1".into();
        value.validate().unwrap();
    }
}
