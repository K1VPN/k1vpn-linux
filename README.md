# K1VPN for Linux

K1VPN 1.0.0 is ready for use. Snap Store approval is pending.
A K1VPN account is required.

WireGuard VPN with a kill switch, in-tunnel DNS, server favorites, automatic
connection and tray controls. Available in English and Greek.

## Build

Linux amd64, Node.js 26.13.0, npm 12.2.1, stable Rust, Snapcraft and initialized
LXD are required.

```sh
nvm install && nvm use
npm install --global npm@12.2.1
npm ci
npm run package:snap
```

Tests: `npm run build` and `cargo test --locked --manifest-path daemon/Cargo.toml`.

Custom builds require a client key for public IP display.

## Support and license

[Contact](https://k1vpn.com/en/contact/). [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md).

[GPL-3.0-only](LICENSE) · [Trademarks](TRADEMARKS.md) ·
[Third-party notices](THIRD_PARTY_NOTICES.md).
