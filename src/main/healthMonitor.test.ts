import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthMonitor, type HealthDeps } from './healthMonitor'
import type { UplinkSource } from './network'

const disconnected = {
  state: 'disconnected',
  recovery_required: false,
  last_handshake_secs_ago: null,
  rx_bytes: null
}

const connected = {
  state: 'connected',
  server_id: 'gr-athens-1',
  recovery_required: false,
  last_handshake_secs_ago: 5,
  rx_bytes: 1_000
}

function uplink(): UplinkSource & { change(): void; reading: { state: 'up' | 'down'; key: string } } {
  let listener: (() => void) | undefined
  const source = {
    reading: { state: 'up' as 'up' | 'down', key: 'eth0=192.0.2.5/24' },
    read: () => source.reading,
    watch: (onChange: () => void) => {
      listener = onChange
      return () => { listener = undefined }
    },
    change: () => listener?.()
  }
  return source
}

const monitors: HealthMonitor[] = []

function build(overrides: Partial<HealthDeps> = {}): { monitor: HealthMonitor; deps: HealthDeps } {
  const deps: HealthDeps = {
    status: async () => disconnected,
    probe: async () => ({ ip: '203.0.113.7', countryCode: 'GR', countryName: 'Greece' }),
    verify: async () => 'verified',
    uplink: uplink(),
    ...overrides
  }
  const monitor = new HealthMonitor(deps)
  monitors.push(monitor)
  return { monitor, deps }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.stop()
  vi.useRealTimers()
})

describe('HealthMonitor', () => {
  it('checks the tunnel immediately and confirms protection even when IP lookup is unavailable', async () => {
    const verify = vi.fn(async () => 'verified' as const)
    const { monitor } = build({
      status: async () => connected,
      probe: async () => { throw new Error('lookup not configured') },
      verify
    })
    monitor.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(monitor.get()).toMatchObject({ display: 'protected', ipState: 'unavailable' })
  })

  it('never confirms protection when both the peer check and IP lookup fail', async () => {
    const { monitor } = build({
      status: async () => connected,
      probe: async () => { throw new Error('offline') },
      verify: async () => 'inconclusive'
    })
    monitor.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.get().display).toBe('verifying')
  })
  it('publishes the service status with monotonic revisions', async () => {
    const { monitor } = build()
    const revisions: number[] = []
    monitor.subscribe((snapshot) => revisions.push(snapshot.revision))
    monitor.start()
    await monitor.refresh()
    expect(monitor.get()).toMatchObject({ display: 'disconnected', network: 'up' })
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions)
    const settled = monitor.get().revision
    await monitor.refresh()
    expect(monitor.get().revision).toBe(settled)
  })

  it('reports unknown, never protected, when the service cannot be read', async () => {
    const { monitor } = build({ status: async () => { throw new Error('offline') } })
    monitor.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(monitor.get().display).toBe('unknown')
    await monitor.refresh()
    expect(monitor.get().display).toBe('unknown')
  })

  it('coalesces overlapping refreshes into one request at a time', async () => {
    let release!: (value: unknown) => void
    const status = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const { monitor } = build({ status })
    monitor.start()
    const first = monitor.refresh()
    const second = monitor.refresh()
    expect(status).toHaveBeenCalledTimes(1)
    release(disconnected)
    await vi.advanceTimersByTimeAsync(0)
    release(disconnected)
    await Promise.all([first, second])
  })

  it('does not look up the address until it is allowed and a window shows', async () => {
    const probe = vi.fn(async () => ({ ip: '203.0.113.7', countryCode: null, countryName: null }))
    const { monitor } = build({ probe, addressLookupAllowed: false })
    monitor.start()
    await monitor.refresh()
    monitor.setWindowVisible(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(probe).not.toHaveBeenCalled()
    monitor.allowAddressLookup()
    await vi.advanceTimersByTimeAsync(10)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(monitor.get().publicIp).toMatchObject({ ip: '203.0.113.7' })
  })

  it('looks up the address through the tunnel once connected', async () => {
    const probe = vi.fn(async () => ({ ip: '198.51.100.9', countryCode: 'NL', countryName: 'Netherlands' }))
    const { monitor } = build({ status: async () => connected, probe })
    monitor.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(probe).toHaveBeenCalled()
    expect(monitor.get().publicIp).toMatchObject({ ip: '198.51.100.9' })
  })

  it('pauses polling during an operation and allows only one at a time', async () => {
    const status = vi.fn(async () => disconnected)
    const { monitor } = build({ status })
    monitor.start()
    await monitor.refresh()
    let finish!: () => void
    const running = monitor.operation('connecting', () => new Promise<void>((resolve) => { finish = resolve }), 'gr-athens-1')
    expect(monitor.get().display).toBe('connecting')
    await expect(monitor.operation('disconnecting', async () => undefined)).rejects.toThrow('busy')
    const before = status.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(status.mock.calls.length).toBe(before)
    finish()
    await running
    await vi.advanceTimersByTimeAsync(10)
    expect(status.mock.calls.length).toBeGreaterThan(before)
  })

  it('discards a status that was in flight when the epoch changed', async () => {
    let release!: (value: unknown) => void
    const status = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
      .mockResolvedValue(disconnected)
    const { monitor } = build({ status })
    monitor.start()
    monitor.invalidate('account')
    release(connected)
    await vi.advanceTimersByTimeAsync(10)
    expect(monitor.get().display).toBe('disconnected')
  })

  it('treats a network change as a new epoch and reads the status again', async () => {
    const source = uplink()
    const status = vi.fn(async () => disconnected)
    const { monitor } = build({ status, uplink: source })
    monitor.start()
    await monitor.refresh()
    const before = status.mock.calls.length
    source.reading = { state: 'up', key: 'wlan0=198.51.100.20/24' }
    source.change()
    await vi.advanceTimersByTimeAsync(400)
    expect(status.mock.calls.length).toBeGreaterThan(before)
  })

  it('reports no network when the uplink is down', async () => {
    const source = uplink()
    source.reading = { state: 'down', key: '' }
    const { monitor } = build({ uplink: source })
    monitor.start()
    await monitor.refresh()
    expect(monitor.get().network).toBe('down')
  })
})
