import type { HealthSnapshot } from '../../../shared/connectionHealth'
import { serverListFetchNeeded, serverListRetryWait } from './serverCache'

/** Keep retry timing stable while unrelated IP/status readings change. */
export function serverListRetryDelay(
  health: Pick<HealthSnapshot, 'network' | 'display' | 'ipState'>
): number | undefined {
  if (
    health.network === 'down' ||
    ['no-internet', 'connecting', 'disconnecting', 'checking', 'unknown'].includes(health.display)
  )
    return
  return health.display === 'protected' ||
    (health.display === 'disconnected' && health.ipState === 'ready')
    ? 1000
    : 10_000
}

/** Only a failed first load needs retries; a successful session list survives every health change. */
export function scheduleServerListRetry(
  account: string,
  error: string,
  loading: boolean,
  delay: number | undefined,
  retry: () => void
): (() => void) | undefined {
  if (!error || loading || delay === undefined || !serverListFetchNeeded(account)) return
  // Spread prompt recovery attempts over several seconds, not a synchronized one-second wave.
  const timer = setTimeout(
    retry,
    Math.max(delay + Math.round(Math.random() * 4000), serverListRetryWait(account))
  )
  return () => clearTimeout(timer)
}
