import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore, parseLastServer, parseSettings } from './settingsStore'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'k1vpn-settings-'))
  directories.push(directory)
  return join(directory, 'preferences.json')
}

describe('settings parsing and persistence', () => {
  it('uses safe defaults for absent or malformed values', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ autoStart: 'yes', killSwitch: true, dns: { mode: 'custom', custom: ['127.0.0.1'] } })).toEqual({
      ...DEFAULT_SETTINGS,
      killSwitch: true
    })
  })

  it('normalizes persisted DNS settings', () => {
    expect(parseSettings({ dns: { mode: 'custom', custom: [' 1.1.1.1 ', '1.1.1.1'] } }).dns).toEqual({
      mode: 'custom',
      custom: ['1.1.1.1']
    })
  })

  it('persists validated updates and reloads them', async () => {
    const path = await temporaryPath()
    const store = await SettingsStore.open(path)
    await store.set('killSwitch', true)
    await store.setDns('cloudflare', [])
    const reopened = await SettingsStore.open(path)
    expect(reopened.get()).toMatchObject({ killSwitch: true, dns: { mode: 'cloudflare', custom: [] } })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(reopened.get())
  })

  it('remembers the last server per account and only offers it with auto-connect on', async () => {
    const path = await temporaryPath()
    const store = await SettingsStore.open(path)
    await store.rememberServer('gr-athens-1', 'alice')
    expect(store.automaticServer('alice')).toBeNull()
    expect(store.lastServerFor('alice')).toBe('gr-athens-1')
    expect(store.lastServerFor('bob')).toBeNull()
    await store.set('autoConnect', true)
    expect(store.automaticServer('alice')).toBe('gr-athens-1')
    expect(store.automaticServer('bob')).toBeNull()
    const reopened = await SettingsStore.open(path)
    expect(reopened.automaticServer('alice')).toBe('gr-athens-1')
    expect(reopened.get()).not.toHaveProperty('lastServer')
  })

  it('ignores a malformed remembered server', () => {
    expect(parseLastServer({ lastServer: { id: '../x', username: 'a' } })).toBeNull()
    expect(parseLastServer({ lastServer: { id: 'ok', username: '' } })).toBeNull()
    expect(parseLastServer({ lastServer: { id: 'ok', username: 'a' } })).toEqual({ id: 'ok', username: 'a' })
  })

  it('rejects invalid IPC-shaped input', async () => {
    const store = await SettingsStore.open(await temporaryPath())
    await expect(store.set('unknown', true)).rejects.toThrow('Invalid settings key')
    await expect(store.set('killSwitch', 'true')).rejects.toThrow('must be boolean')
    await expect(store.setDns('custom', ['10.0.0.1'])).rejects.toThrow('local or private')
  })

  it('recovers from invalid JSON without trusting it', async () => {
    const path = await temporaryPath()
    await writeFile(path, '{not-json', 'utf8')
    expect((await SettingsStore.open(path)).get()).toEqual(DEFAULT_SETTINGS)
  })
})
