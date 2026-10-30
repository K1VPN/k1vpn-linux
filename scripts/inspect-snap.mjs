import { spawnSync } from 'node:child_process'

const artifact = process.argv[2]
if (!artifact?.endsWith('.snap')) throw new Error('Pass the .snap artifact to inspect')
const result = spawnSync('unsquashfs', ['-l', artifact], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
if (result.status !== 0) throw new Error('Could not read Snap contents')
const files = result.stdout.split('\n').filter(line => line.startsWith('squashfs-root/'))
  .map(line => line.slice('squashfs-root/'.length))
for (const required of [
  'meta/snap.yaml', 'bin/k1vpnd', 'bin/k1vpn-launch',
  'usr/bin/gdbus',
  'meta/polkit/k1vpn-polkit.network-control.policy',
  'k1vpn/k1vpn', 'k1vpn/resources/app.asar',
  'k1vpn/resources/icons/k1vpn.png', 'k1vpn/resources/licenses/Inter-LICENSE.txt',
  'libexec/k1vpn-tools/wg', 'libexec/k1vpn-tools/ip', 'libexec/k1vpn-tools/nft'
]) {
  if (!files.includes(required)) throw new Error(`Snap is missing ${required}`)
}
// Every executable the Snap ships outside Electron and the GNOME/GPU mounts.
const EXECUTABLE_DIRECTORY = /^(bin|sbin|usr\/bin|usr\/sbin|libexec\/k1vpn-tools)\/[^/]+$/
const ALLOWED_EXECUTABLES = new Set([
  'bin/k1vpnd', 'bin/k1vpn-launch', 'usr/bin/gdbus',
  'libexec/k1vpn-tools/wg', 'libexec/k1vpn-tools/ip', 'libexec/k1vpn-tools/nft'
])
const forbidden = files.filter(file =>
  /(^|\/)\.env(?:\.|$)|(^|\/)\.git(?:\/|$)|(^|\/)(credentials\.dat|preferences\.json|recovery\.json|k1vpn0\.conf)$/.test(file)
  || /^k1vpn\/resources\/(daemon|systemd|polkit|apparmor|networkmanager)(\/|$)/.test(file)
  || file === 'k1vpn/libvulkan.so.1'
  || EXECUTABLE_DIRECTORY.test(file) && !ALLOWED_EXECUTABLES.has(file)
)
if (forbidden.length) throw new Error(`Unexpected private/development files: ${forbidden.join(', ')}`)
const manifest = spawnSync('unsquashfs', ['-cat', artifact, 'meta/snap.yaml'], { encoding: 'utf8' })
if (manifest.status !== 0 || !/^confinement: strict\s*$/m.test(manifest.stdout) || !/^base: core26\s*$/m.test(manifest.stdout) || !/^grade: stable\s*$/m.test(manifest.stdout)) {
  throw new Error('Expected a strictly confined core26 Snap with grade: stable')
}
console.log('Snap runtime contents checked: strict confinement, core26, grade: stable; no local env, credentials or Debian service resources.')
