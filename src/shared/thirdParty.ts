/** Short About credits; complete notices remain in the distributed package. */
export const THIRD_PARTY_PACKAGES = [
  { name: 'Electron', licenses: [{ name: 'MIT', url: 'https://github.com/electron/electron/blob/main/LICENSE' }] },
  { name: 'React / React DOM', licenses: [{ name: 'MIT', url: 'https://github.com/react/react/blob/main/LICENSE' }] },
  { name: 'country-flag-icons', licenses: [{ name: 'MIT', url: 'https://github.com/catamphetamine/country-flag-icons/blob/master/LICENSE' }] },
  { name: 'Inter', licenses: [{ name: 'SIL OFL 1.1', url: 'https://github.com/rsms/inter/blob/master/LICENSE.txt' }] },
  { name: 'WireGuard tools', licenses: [{ name: 'GPL-2.0', url: 'https://git.zx2c4.com/wireguard-tools/tree/COPYING' }] },
  { name: 'nftables', licenses: [{ name: 'GPL-2.0', url: 'https://git.netfilter.org/nftables/tree/COPYING' }] },
  { name: 'zbus', licenses: [{ name: 'MIT', url: 'https://docs.rs/crate/zbus/6.1.0/source/LICENSE' }] },
  { name: 'nix', licenses: [{ name: 'MIT', url: 'https://docs.rs/crate/nix/0.31.3/source/LICENSE' }] },
  { name: 'serde', licenses: [
    { name: 'MIT', url: 'https://docs.rs/crate/serde/1.0.229/source/LICENSE-MIT' },
    { name: 'Apache-2.0', url: 'https://docs.rs/crate/serde/1.0.229/source/LICENSE-APACHE' }
  ] },
  { name: 'serde_json', licenses: [
    { name: 'MIT', url: 'https://docs.rs/crate/serde_json/1.0.154/source/LICENSE-MIT' },
    { name: 'Apache-2.0', url: 'https://docs.rs/crate/serde_json/1.0.154/source/LICENSE-APACHE' }
  ] },
  { name: 'base64', licenses: [
    { name: 'MIT', url: 'https://docs.rs/crate/base64/0.23.1/source/LICENSE-MIT' },
    { name: 'Apache-2.0', url: 'https://docs.rs/crate/base64/0.23.1/source/LICENSE-APACHE' }
  ] },
  { name: 'zeroize', licenses: [
    { name: 'MIT', url: 'https://docs.rs/crate/zeroize/1.9.1/source/LICENSE-MIT' },
    { name: 'Apache-2.0', url: 'https://docs.rs/crate/zeroize/1.9.1/source/LICENSE-APACHE' }
  ] }
] as const

export const THIRD_PARTY_LICENSE_URLS: ReadonlySet<string> = new Set(
  THIRD_PARTY_PACKAGES.flatMap(component => component.licenses.map(license => license.url))
)
