import { describe, expect, it } from 'vitest'
import { CHECKING_SNAPSHOT, type HealthDisplay, type HealthSnapshot } from '../shared/connectionHealth'
import { desktopText, gdbusPath, trayActions, trayState, withTrayPixmap } from './trayModel'

const snapshot = (changes: Partial<HealthSnapshot>): HealthSnapshot => ({ ...CHECKING_SNAPSHOT, ...changes })

describe('Snap GNOME tray transport', () => {
  it('selects pixmaps only during native construction and restores the desktop', () => {
    const env = { SNAP_NAME: 'k1vpn', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }
    const icon = {}
    expect(withTrayPixmap(() => {
      expect(env.XDG_CURRENT_DESKTOP).toBe('Unity')
      return icon
    }, env, 'linux')).toBe(icon)
    expect(env.XDG_CURRENT_DESKTOP).toBe('ubuntu:GNOME')
  })
  it('restores the desktop even if native construction fails', () => {
    const env = { SNAP_NAME: 'k1vpn', XDG_CURRENT_DESKTOP: 'GNOME' }
    expect(() => withTrayPixmap(() => { throw new Error('native failure') }, env, 'linux')).toThrow('native failure')
    expect(env.XDG_CURRENT_DESKTOP).toBe('GNOME')
  })
  it.each([
    { XDG_CURRENT_DESKTOP: 'GNOME' },
    { SNAP_NAME: 'k1vpn', XDG_CURRENT_DESKTOP: 'KDE' },
    { SNAP_NAME: 'k1vpn' }
  ])('preserves other desktop configurations: %j', (env) => {
    const original = { ...env }
    withTrayPixmap(() => expect(env).toEqual(original), env, 'linux')
    expect(env).toEqual(original)
  })
})

describe('tray follows the shared connection state', () => {
  it.each(['checking', 'unknown', 'blocked', 'connecting', 'disconnecting', 'verifying', 'no-internet'] as HealthDisplay[])(
    'never paints %s green or red', (display) => {
      expect(trayState(snapshot({ display }))).toBe('amber')
    }
  )
  it('reserves green for protected and red for disconnected', () => {
    expect(trayState(snapshot({ display: 'protected' }))).toBe('green')
    expect(trayState(snapshot({ display: 'disconnected' }))).toBe('red')
    expect(trayState(snapshot({ display: 'protected', operation: 'quitting' }))).toBe('amber')
  })
  it('allows disconnect on unverified or offline tunnels, but never a second operation', () => {
    for (const display of ['verifying', 'protected', 'no-internet'] as const) {
      expect(trayActions(snapshot({ display, tunnelUp: true }))).toEqual({ connect: false, disconnect: true })
      expect(trayActions(snapshot({ display, tunnelUp: true, operation: 'disconnecting' }))).toEqual({ connect: false, disconnect: false })
    }
  })
  it('allows connect only when confirmed disconnected', () => {
    expect(trayActions(snapshot({ display: 'disconnected' }))).toEqual({ connect: true, disconnect: false })
    expect(trayActions(CHECKING_SNAPSHOT)).toEqual({ connect: false, disconnect: false })
  })
  it('translates the same menu and lifecycle messages in both languages', () => {
    expect(Object.keys(desktopText.en).sort()).toEqual(Object.keys(desktopText.el).sort())
  })
})

describe('status-icon host probe', () => {
  it('uses the gdbus staged in the Snap, since core24 has none', () => {
    expect(gdbusPath({ SNAP_NAME: 'k1vpn', SNAP: '/snap/k1vpn/x3' })).toBe('/snap/k1vpn/x3/usr/bin/gdbus')
    expect(gdbusPath({})).toBe('/usr/bin/gdbus')
  })
  it('ignores a SNAP value outside the k1vpn mount', () => {
    expect(gdbusPath({ SNAP_NAME: 'k1vpn', SNAP: '/tmp/evil' })).toBe('/usr/bin/gdbus')
    expect(gdbusPath({ SNAP_NAME: 'k1vpn', SNAP: '/snap/k1vpn/x3/../../tmp' })).toBe('/usr/bin/gdbus')
    expect(gdbusPath({ SNAP_NAME: 'k1vpn', SNAP: '/snap/k1vpn/..' })).toBe('/usr/bin/gdbus')
  })
})
