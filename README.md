# K1VPN for Linux

K1VPN 1.0.0 is a Linux desktop client. Snap Store approval is pending.
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

## Credential storage verification

Electron 45's asynchronous safeStorage uses the Secret portal when available,
with desktop keyring support retained for existing installations. The portal
uses the Snap's existing `desktop` interface; `password-manager-service` remains
an optional keyring connection. The application rejects the fixed-key `v10`
fallback and preserves saved credentials when their provider cannot decrypt them.
The ciphertext format and existing credential file location are unchanged.

An isolated check with dummy data can be run twice using the same profile:

```sh
node_modules/electron/dist/electron scripts/check-secret-portal.cjs write /tmp/k1vpn-portal-check
node_modules/electron/dist/electron scripts/check-secret-portal.cjs read /tmp/k1vpn-portal-check
```

Before release, test the built strict Snap on GNOME and KDE with
`password-manager-service` disconnected: remember a test account, close and reopen
the application, then reboot and reconnect with the saved account. Also verify
existing keyring credentials with the interface connected, and that an unavailable
or locked secret provider does not overwrite or delete credentials. A desktop
portal backend is required; the desktop check alone does not verify confinement.

## Release validation

Publish only a complete Snapcraft build that passes
`node scripts/inspect-snap.mjs PATH_TO_SNAP` and Canonical's
`review-tools.snap-review PATH_TO_SNAP`. Store declarations may still require
manual approval. Local packages installed with `--dangerous` do not verify Store
installation or auto-connections.

## Support and license

[Contact](https://k1vpn.com/en/contact/). [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md).

[GPL-3.0-only](LICENSE) · [Trademarks](TRADEMARKS.md) ·
[Third-party notices](THIRD_PARTY_NOTICES.md).
