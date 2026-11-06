import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearServerList, loadServerList, readServerList } from './serverCache'
import { scheduleServerListRetry, serverListRetryDelay } from './serverListRetry'

beforeEach(() => {
  clearServerList()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('first server-list load recovery', () => {
  it('automatically loads the list when connectivity returns after the first request failed', async () => {
    const fetchList = vi
      .fn()
      .mockRejectedValueOnce(new Error('Cannot reach VPN servers'))
      .mockResolvedValue([])
    await expect(loadServerList('alice', fetchList)).rejects.toThrow()
    const retry = vi.fn(() => {
      void loadServerList('alice', fetchList)
    })
    scheduleServerListRetry(
      'alice',
      'Offline',
      false,
      serverListRetryDelay({ network: 'down', display: 'no-internet', ipState: 'unavailable' }),
      retry
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchList).toHaveBeenCalledTimes(1)
    scheduleServerListRetry(
      'alice',
      'Offline',
      false,
      serverListRetryDelay({ network: 'up', display: 'protected', ipState: 'ready' }),
      retry
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchList).toHaveBeenCalledTimes(2)
    expect(readServerList('alice')).toEqual({ list: [] })
  })

  it('never refetches an existing session list on VPN/network recovery', async () => {
    await loadServerList('alice', async () => [])
    const retry = vi.fn()
    scheduleServerListRetry(
      'alice',
      'Old failure',
      false,
      serverListRetryDelay({ network: 'up', display: 'protected', ipState: 'ready' }),
      retry
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('cancels the scheduled retry when the screen closes or connectivity is lost again', async () => {
    const retry = vi.fn()
    const cancel = scheduleServerListRetry(
      'alice',
      'Offline',
      false,
      serverListRetryDelay({ network: 'up', display: 'disconnected', ipState: 'ready' }),
      retry
    )
    cancel?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('does not schedule a duplicate request while a list load is already in progress', async () => {
    const retry = vi.fn()
    scheduleServerListRetry(
      'alice',
      'Offline',
      true,
      serverListRetryDelay({ network: 'up', display: 'protected', ipState: 'ready' }),
      retry
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('also retries when connectivity evidence is still being verified', async () => {
    const retry = vi.fn()
    scheduleServerListRetry(
      'alice',
      'Offline',
      false,
      serverListRetryDelay({ network: 'unknown', display: 'verifying', ipState: 'checking' }),
      retry
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
