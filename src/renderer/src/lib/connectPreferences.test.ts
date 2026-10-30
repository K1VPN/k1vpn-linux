import { describe, expect, it } from 'vitest'
import { availableSelectedServer, ConnectPreferencesStore } from './connectPreferences'

function storage(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
} {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('remembered connection choices', () => {
  it('keeps the server and Favorites tab after disconnect and app restart', () => {
    const disk = storage()
    const session = new ConnectPreferencesStore(() => disk)
    session.update('alice', { serverId: 'gr-1', tab: 'favorites' })
    session.rememberConnection('alice', { tunnelUp: true, serverId: 'gr-1' })
    session.rememberConnection('alice', { tunnelUp: false, serverId: null })
    expect(session.read('alice')).toEqual({ serverId: 'gr-1', tab: 'favorites' })
    const restarted = new ConnectPreferencesStore(() => disk)
    expect(restarted.read('alice')).toEqual(session.read('alice'))
    expect(availableSelectedServer(restarted.read('alice'), [{ id: 'gr-1' }])).toBe('gr-1')
  })

  it('remembers the actual native/automatic connection without changing the tab', () => {
    const session = new ConnectPreferencesStore(storage)
    session.update('alice', { serverId: 'old', tab: 'favorites' })
    session.rememberConnection('alice', { tunnelUp: true, serverId: 'native' })
    session.rememberConnection('alice', { tunnelUp: false, serverId: null })
    expect(session.read('alice')).toEqual({ serverId: 'native', tab: 'favorites' })
  })

  it('keeps different accounts separate, including when returning to a saved account', () => {
    const disk = storage()
    const session = new ConnectPreferencesStore(() => disk)
    session.update('alice', { serverId: 'gr-1', tab: 'favorites' })
    expect(session.read('bob')).toEqual({ serverId: '', tab: 'all' })
    session.update('bob', { serverId: 'de-1' })
    const restarted = new ConnectPreferencesStore(() => disk)
    expect(restarted.read('alice')).toEqual({ serverId: 'gr-1', tab: 'favorites' })
    expect(restarted.read('bob')).toEqual({ serverId: 'de-1', tab: 'all' })
  })

  it('does not enable reconnect to a removed server, or before the list has loaded', () => {
    const choice = { serverId: 'removed', tab: 'favorites' as const }
    expect(availableSelectedServer(choice, [])).toBe('')
    expect(availableSelectedServer(choice, [{ id: 'other' }])).toBe('')
  })

  it('survives unreadable storage and keeps choices across screen subscriptions', () => {
    const session = new ConnectPreferencesStore(() => {
      throw new Error('Unavailable')
    })
    let renders = 0
    const unsubscribe = session.subscribe(() => {
      renders += 1
    })
    session.update('alice', { serverId: 'gr-1', tab: 'favorites' })
    unsubscribe()
    session.rememberConnection('alice', { tunnelUp: false, serverId: null })
    expect(session.read('alice')).toEqual({ serverId: 'gr-1', tab: 'favorites' })
    expect(renders).toBe(1)
    expect(session.read('alice')).toBe(session.read('alice'))
  })

  it('tolerates malformed and invalid saved preferences', () => {
    for (const raw of ['{', 'null', '42', '{"serverId":42,"tab":"invalid"}']) {
      const session = new ConnectPreferencesStore(() => ({ getItem: () => raw, setItem: () => {} }))
      expect(session.read('alice')).toEqual({ serverId: '', tab: 'all' })
    }
  })
})
