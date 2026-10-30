import { chmod, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The current Snap build targets Linux amd64')
}
const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
for (const [command, args] of [
  ['npm', ['run', 'build']],
  ['npx', ['electron-builder', '--linux', 'dir', '--x64', '--publish', 'never']]
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Use a whitelist, never the workspace as a Snap source. Local .env files,
// credentials, Git metadata and daemon build caches stay outside these inputs.
await rm('.snap-build', { recursive: true, force: true })
await mkdir('.snap-build/daemon', { recursive: true })
await mkdir('.snap-build/application', { recursive: true })
await cp('release/linux-unpacked', '.snap-build/application/k1vpn', { recursive: true })
await rm('.snap-build/application/k1vpn/resources/app-update.yml', { force: true })
// The Vulkan loader comes from the mesa-2604 GPU content interface.
await rm('.snap-build/application/k1vpn/libvulkan.so.1', { force: true })
async function normalizeModes(directory) {
  await chmod(directory, 0o755)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) await normalizeModes(path)
    else if (entry.isFile()) await chmod(path, (await stat(path)).mode & 0o111 ? 0o755 : 0o644)
  }
}
// Electron ZIP entries may be writable by everyone. The Snap uses Chromium's
// user-namespace sandbox, with a regular non-setuid helper.
await normalizeModes('.snap-build/application')
for (const file of ['Cargo.toml', 'Cargo.lock']) {
  await cp(`daemon/${file}`, `.snap-build/daemon/${file}`)
}
await cp('daemon/src', '.snap-build/daemon/src', { recursive: true })
console.log('Prepared clean Snap inputs; the daemon will be compiled inside core26.')
