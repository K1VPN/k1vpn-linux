import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from '../types'
import {
  clearServerList,
  loadServerList,
  readServerList,
  serverListFetchNeeded,
  storeServerList
} from './serverCache'

const server = (id: string): Server => ({
  id,
  countryCode: 'GR',
  countryName: 'Greece',
  city: null,
  label: null,
  isRecommended: false,
  isFeatured: false,
  loadPercent: null
})

beforeEach(() => clearServerList())

describe('server list cache', () => {
  it('is empty until something is stored', () => {
    expect(readServerList('alice')).toBeUndefined()
  })

  it('keeps the list for the entire session, even when the clock advances by days', async () => {
    vi.useFakeTimers()
    try {
      const fetchList = vi.fn().mockResolvedValue([server('a')])
      await loadServerList('alice', fetchList)
      vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000)
      expect(readServerList('alice')).toEqual({ list: [server('a')] })
      expect(serverListFetchNeeded('alice')).toBe(false)
      await loadServerList('alice', fetchList)
      expect(fetchList).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never hands one account the list of another', () => {
    storeServerList('alice', [server('a')])
    expect(readServerList('bob')).toBeUndefined()
    storeServerList('bob', [server('b')])
    expect(readServerList('alice')).toBeUndefined()
  })

  it('is dropped at sign-out', () => {
    storeServerList('alice', [server('a')])
    clearServerList()
    expect(readServerList('alice')).toBeUndefined()
  })

  it('keeps already loaded servers through network loss without asking the backend again', async () => {
    const fetchList = vi
      .fn()
      .mockResolvedValueOnce([server('a')])
      .mockRejectedValue(new Error('Offline'))
    await loadServerList('alice', fetchList)
    for (let remount = 0; remount < 5; remount++) {
      expect(await loadServerList('alice', fetchList)).toEqual([server('a')])
    }
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight request across screen remounts and caches its completion', async () => {
    let finish!: (list: Server[]) => void
    const fetchList = vi.fn(
      () =>
        new Promise<Server[]>((resolve) => {
          finish = resolve
        })
    )
    const first = loadServerList('alice', fetchList)
    const second = loadServerList('alice', fetchList)
    expect(second).toBe(first)
    await Promise.resolve()
    finish([server('a')])
    await first
    expect(fetchList).toHaveBeenCalledTimes(1)
    expect(serverListFetchNeeded('alice')).toBe(false)
  })

  it('can retry a failed first load successfully after connectivity returns', async () => {
    const fetchList = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([server('a')])
    await expect(loadServerList('alice', fetchList)).rejects.toThrow('Offline')
    expect(serverListFetchNeeded('alice')).toBe(true)
    expect(await loadServerList('alice', fetchList)).toEqual([server('a')])
    expect(serverListFetchNeeded('alice')).toBe(false)
  })

  it('never refetches a successfully loaded empty list', async () => {
    const fetchList = vi.fn().mockResolvedValue([])
    await loadServerList('alice', fetchList)
    expect(serverListFetchNeeded('alice')).toBe(false)
    await loadServerList('alice', fetchList)
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('does not let a slow response repopulate the cache after sign-out', async () => {
    let finish!: (list: Server[]) => void
    const first = loadServerList(
      'alice',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await Promise.resolve()
    clearServerList()
    finish([server('a')])
    await first
    expect(readServerList('alice')).toBeUndefined()
    expect(await loadServerList('alice', async () => [server('new')])).toEqual([server('new')])
  })

  it('does not let an older account response overwrite a newer account list', async () => {
    let finish!: (list: Server[]) => void
    const first = loadServerList(
      'alice',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await Promise.resolve()
    await loadServerList('bob', async () => [server('b')])
    finish([server('a')])
    await first
    expect(readServerList('bob')).toEqual({ list: [server('b')] })
    expect(readServerList('alice')).toBeUndefined()
  })
})

describe('API failure retry budget', () => {
  it('retains cooldown through remounts and repeated health updates', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const { serverListRetryWait } = await import('./serverCache')
      const fetchList = vi.fn().mockRejectedValue(new Error('API unavailable'))
      for (let attempt = 0; attempt < 8; attempt++) {
        await expect(loadServerList('alice', fetchList)).rejects.toThrow()
        const wait = serverListRetryWait('alice')
        expect(wait).toBeGreaterThanOrEqual(2000)
        for (let remount = 0; remount < 20; remount++) {
          expect(serverListFetchNeeded('alice')).toBe(true)
          expect(serverListRetryWait('alice')).toBe(wait)
        }
        await vi.advanceTimersByTimeAsync(wait)
      }
      expect(serverListRetryWait('alice')).toBe(0)
      expect(fetchList).toHaveBeenCalledTimes(8)
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })
})
