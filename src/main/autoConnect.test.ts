import { describe, expect, it, vi } from 'vitest'
import { AuthSessionError } from './authManager'
import { VpnDaemonError } from './daemonClient'
import { AutoConnect, AutoConnectErrorState, autoConnectErrorCode } from './autoConnect'

type Deps = ConstructorParameters<typeof AutoConnect>[0]

function build(overrides: Partial<Deps> = {}) {
  const base = {
    server: vi.fn(() => 'srv-1'),
    isCurrent: vi.fn(() => true),
    connect: vi.fn(async (_serverId: string, _stillCurrent: () => boolean): Promise<unknown> => undefined),
    error: vi.fn()
  }
  const deps = { ...base, ...overrides } as Deps & typeof base
  return { deps, auto: new AutoConnect(deps) }
}

describe('AutoConnect', () => {
  it('connects once to the remembered server', async () => {
    const { deps, auto } = build()
    await auto.start('alice')
    await auto.start('alice')
    expect(deps.connect).toHaveBeenCalledTimes(1)
    expect(deps.connect.mock.calls[0][0]).toBe('srv-1')
  })

  it('does nothing without a remembered server', async () => {
    const { deps, auto } = build({ server: vi.fn(() => null) })
    await auto.start('alice')
    expect(deps.connect).not.toHaveBeenCalled()
    expect(deps.error).not.toHaveBeenCalled()
  })

  it('is cancelled by an explicit user action', async () => {
    const { deps, auto } = build()
    auto.cancel()
    await auto.start('alice')
    expect(deps.connect).not.toHaveBeenCalled()
  })

  it('does not report a failure after being superseded', async () => {
    let fail: (reason: Error) => void = () => undefined
    const { deps, auto } = build({ connect: vi.fn(() => new Promise<never>((_, reject) => { fail = reject })) })
    const running = auto.start('alice')
    auto.cancel()
    fail(new Error('late'))
    await running
    expect(deps.error).not.toHaveBeenCalled()
  })

  it('reports a failure while still current', async () => {
    const failure = new Error('boom')
    const { deps, auto } = build({ connect: vi.fn(async () => { throw failure }) })
    await auto.start('alice')
    expect(deps.error).toHaveBeenCalledWith(failure)
  })

  it('stops when the account changed before connecting', async () => {
    const { deps, auto } = build({ isCurrent: vi.fn(() => false) })
    await auto.start('alice')
    expect(deps.connect).not.toHaveBeenCalled()
  })
})

describe('auto-connect failure reporting', () => {
  it('maps errors to stable codes', () => {
    expect(autoConnectErrorCode(new AuthSessionError('NETWORK', 'x'))).toBe('NETWORK')
    expect(autoConnectErrorCode(new VpnDaemonError('authorization_required', 'x'))).toBe('VPN_PERMISSION')
    expect(autoConnectErrorCode(new VpnDaemonError('snap_interfaces_missing', 'x'))).toBe('SNAP_PERMISSION')
    expect(autoConnectErrorCode(new VpnDaemonError('unavailable', 'x'))).toBe('VPN')
    expect(autoConnectErrorCode(new TypeError('x'))).toBe('CONFIG')
    expect(autoConnectErrorCode(new Error('x'))).toBe('INTERNAL')
  })

  it('keeps a failure until the matching id is acknowledged', () => {
    const emit = vi.fn()
    const state = new AutoConnectErrorState(emit)
    state.report(new Error('a'))
    const first = state.get()!
    state.report(new Error('b'))
    state.acknowledge(first.id)
    expect(state.get()?.id).toBe(first.id + 1)
    state.acknowledge(first.id + 1)
    expect(state.get()).toBeNull()
    expect(emit).toHaveBeenLastCalledWith(null)
  })
})
