<div align="center">
  <img src="snap/gui/k1vpn.png" alt="K1VPN logo" width="112" />
  <h1>K1VPN for Linux</h1>
  <p><strong>The official K1VPN desktop client for Linux.</strong></p>
  <p>A WireGuard VPN app with full-tunnel routing, in-tunnel DNS and an optional kill switch.</p>
  <p>
    <a href="https://github.com/K1VPN/k1vpn-linux/actions/workflows/ci.yml"><img src="https://github.com/K1VPN/k1vpn-linux/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build status"></a>
    <a href="LICENSE">GPL-3.0-only</a>
    · <a href="https://k1vpn.com/en/">K1VPN</a>
  </p>
</div>

K1VPN for Linux lets K1VPN subscribers choose a VPN server, connect through
WireGuard and check the public IP address used by the connection. The interface
is available in English and Greek.

## Features

- Full-tunnel WireGuard connections through the K1VPN network.
- DNS requests routed through the VPN tunnel.
- Optional kill switch to block internet traffic outside the VPN while connected.
- Server favorites and automatic connection preferences.
- Public IP status and desktop tray controls.
- Credential storage through the desktop keyring when the system provides it.

## Availability

The official Linux Snap is being prepared for public release. The Snap Store
installation link will be added here when it is available. A K1VPN account is
required to sign in.

## First launch permissions

On systems where Snap does not connect the required interfaces automatically,
K1VPN will show a **Copy command** button. Copy the command from the app, paste
it into a terminal and run it. It connects K1VPN's network and firewall
interfaces and restarts its VPN service. The system may ask you to authenticate
as an administrator.

```sh
sudo snap connect k1vpn:network-control && sudo snap connect k1vpn:firewall-control && sudo snap connect k1vpn:k1vpn-polkit :polkit && sudo snap restart k1vpn.k1vpnd
```

Run this only if the K1VPN app asks for these permissions. Return to the app
after the command completes, then try connecting again.

## Build from source

Builds target Linux amd64 and require Node.js 26.13.0, npm 12.2.1, stable Rust,
Snapcraft and initialized LXD.

```sh
nvm install && nvm use
npm install --global npm@12.2.1
npm ci
npm run package:snap
```

To run the project checks:

```sh
npm run build
cargo test --locked --manifest-path daemon/Cargo.toml
```

Custom builds require a client key for public IP display.

## Project links

- [K1VPN website](https://k1vpn.com/en/)
- [K1VPN Linux app guide](https://k1vpn.com/en/support/k1vpn-new-app-guide/)
- [Report a bug](https://github.com/K1VPN/k1vpn-linux/issues)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [License](LICENSE) · [Trademarks](TRADEMARKS.md)
