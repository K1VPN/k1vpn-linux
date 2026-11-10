import { describe, expect, it, vi } from 'vitest'
import { DesktopHealthStore } from './healthStore'
import { CHECKING_SNAPSHOT } from '../../../shared/connectionHealth'

function setup() {
  const api = {
    disconnect: vi.fn(async () => {}),
    restartService: vi.fn(async () => {}),
    health: { refresh: vi.fn(async () => {}) }
  }
  const store = new DesktopHealthStore(api as unknown as Window['api']['vpn'])
  return { api, store }
}

describe('network recovery', () => {
  it('keeps a pushed permission error when the initial error snapshot arrives late', async () => {
    let initial!: (value: null) => void
    let push!: (value: unknown) => void
    const api = {
      autoConnectError: {
        get: () => new Promise<null>(resolve => { initial = resolve }),
        subscribe: (listener: (value: unknown) => void) => { push = listener; return () => {} }
      },
      health: { get: async () => CHECKING_SNAPSHOT, subscribe: () => () => {} }
    }
    const store = new DesktopHealthStore(api as unknown as Window['api']['vpn'])
    store.start()
    push({ id: 1, code: 'SNAP_PERMISSION', message: 'Missing permissions' })
    initial(null)
    await Promise.resolve()
    expect(store.getAutoConnectError()?.code).toBe('SNAP_PERMISSION')
    store.stop()
  })

  it('reports failed cleanup to the UI and still refreshes the protection state', async () => {
    const { api, store } = setup()
    const error = new Error('Cleanup permission denied')
    api.disconnect.mockRejectedValue(error)
    await expect(store.recover('release')).rejects.toBe(error)
    expect(api.health.refresh).toHaveBeenCalledOnce()
  })

  it('preserves the cleanup failure even if the status refresh also fails', async () => {
    const { api, store } = setup()
    const error = new Error('Cleanup failed')
    api.disconnect.mockRejectedValue(error)
    api.health.refresh.mockRejectedValue(new Error('Service unavailable'))
    await expect(store.recover('release')).rejects.toBe(error)
  })

  it('refreshes after successful cleanup and reports an unreadable status', async () => {
    const { api, store } = setup()
    await store.recover('release')
    expect(api.disconnect).toHaveBeenCalledOnce()
    api.health.refresh.mockRejectedValue(new Error('Status unavailable'))
    await expect(store.recover('restart')).rejects.toThrow('Status unavailable')
    expect(api.restartService).toHaveBeenCalledOnce()
  })
})
