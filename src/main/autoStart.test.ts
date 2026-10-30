import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AutoStartManager, autoStartExecutable, desktopEntry } from './autoStart'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('XDG autostart', () => {
  it('quotes executable paths without creating a shell command', () => {
    const entry = desktopEntry('/opt/K1 VPN/a `$pecial` "client"')
    expect(entry).toContain('Exec="/opt/K1 VPN/a \\`\\$pecial\\` \\"client\\""')
    expect(() => desktopEntry('/opt/k1vpn\nmalicious')).toThrow('Invalid executable path')
  })

  it('creates and removes the desktop entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'k1vpn-autostart-'))
    directories.push(directory)
    const path = join(directory, 'autostart', 'com.k1vpn.linux.desktop')
    const manager = new AutoStartManager(path, '/opt/K1VPN/k1vpn')
    await manager.set(true)
    expect(await readFile(path, 'utf8')).toBe(desktopEntry('/opt/K1VPN/k1vpn'))
    await manager.set(false)
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('starts the snap through its stable entry point, not a revision path', () => {
    expect(autoStartExecutable('/snap/k1vpn/12/k1vpn/k1vpn', { SNAP_NAME: 'k1vpn' })).toBe('/snap/bin/k1vpn')
    expect(autoStartExecutable('/opt/K1VPN/k1vpn', {})).toBe('/opt/K1VPN/k1vpn')
  })
})
