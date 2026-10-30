import type { Server } from '../types'
import { requestRetryDelay } from '../../../shared/requestBackoff'

/**
 * The last server list, kept in memory only and scoped to the account it belongs to. Coming back
 * to the connect screen from a menu shows it on the first frame without another request.
 * It lasts for the signed-in session; a different account never sees it, and sign-out drops it.
 */
let entry: { account: string; list: Server[] } | undefined
let generation = 0
let pending: { account: string; promise: Promise<Server[]> } | undefined
let failure: { account: string; attempts: number; retryAt: number } | undefined

export function readServerList(account: string): { list: Server[] } | undefined {
  if (!entry || entry.account !== account) return undefined
  return { list: entry.list }
}

export function storeServerList(account: string, list: Server[]): void {
  entry = { account, list }
  failure = undefined
}

export function clearServerList(): void {
  entry = undefined
  pending = undefined
  failure = undefined
  generation += 1
}

/** A successful list, including an empty one, is loaded just once per session. */
export function serverListFetchNeeded(account: string): boolean {
  return !readServerList(account)
}

/** A screen remount or unrelated health update must not restart an API retry burst. */
export function serverListRetryWait(account: string): number {
  return failure?.account === account ? Math.max(0, failure.retryAt - Date.now()) : 0
}

/** A confirmed offline-to-online change permits a prompt recovery attempt. */
export function resetServerListRetry(account: string): void {
  if (failure?.account === account) failure = undefined
}

/** Share an in-flight first load across screen remounts; save success even if the screen closed. */
export function loadServerList(
  account: string,
  fetchList: () => Promise<Server[]>
): Promise<Server[]> {
  const cached = readServerList(account)
  if (cached) return Promise.resolve(cached.list)
  if (pending?.account === account) return pending.promise
  const token = ++generation
  const promise = Promise.resolve()
    .then(fetchList)
    .then((list) => {
      // A sign-out or request for another account invalidates an older completion.
      if (token === generation) storeServerList(account, list)
      return list
    })
    .catch((error: unknown) => {
      if (token === generation) {
        const attempts = failure?.account === account ? failure.attempts : 0
        failure = {
          account,
          attempts: attempts + 1,
          retryAt: Date.now() + requestRetryDelay(attempts, 2000)
        }
      }
      throw error
    })
    .finally(() => {
      if (pending?.promise === promise) pending = undefined
    })
  pending = { account, promise }
  return promise
}
