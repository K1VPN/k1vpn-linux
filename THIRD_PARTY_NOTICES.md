# Third-party notices

Third-party components retain their own licenses.

## Runtime and distributed components

| Component | Version | License |
|---|---:|---|
| Electron | 45.2.3 | MIT |
| React | 19.3.1 | MIT |
| React DOM | 19.3.1 | MIT |
| country-flag-icons | 1.6.20 | MIT |
| Inter | bundled variable font subsets | SIL Open Font License 1.1 |

Rust dependencies and versions: `daemon/Cargo.lock`. Their licenses include MIT,
Apache-2.0 and Unicode-3.0. JavaScript dependencies: `package-lock.json`.

Electron's `LICENSE` and `LICENSES.chromium.html` must remain in distributions.
Inter's license: `src/renderer/src/assets/fonts/Inter-LICENSE.txt`.

## Build and test tooling

| Component | Version | License |
|---|---:|---|
| electron-vite | 6.0.0 | MIT |
| Vite | 8.3.5 | MIT |
| Vitest | 5.0.5 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| electron-builder | 26.18.0 | MIT |

## Packaged system utilities

| Component | Package | License |
|---|---|---|
| gdbus | libglib2.0-bin | LGPL-2.1-or-later |
| iproute2 | iproute2 | GPL-2.0-only |
| nftables | nftables | GPL-2.0-only |
| WireGuard tools | wireguard-tools | GPL-2.0-only |

These utilities and their copyright files are staged from Ubuntu 26.04. The
complete package notices are included under `usr/share/doc` in the Snap.
WireGuard's kernel implementation is supplied by the host.

These tables summarize direct components. Complete terms are in the individual
packages and their license files.
