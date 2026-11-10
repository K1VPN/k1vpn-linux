import type { HealthDisplay, IpState } from '../../../shared/connectionHealth'

export function ipLookupFailed(display: HealthDisplay, ipState: IpState): boolean {
  return ipState === 'unavailable' || display === 'unknown' || display === 'no-internet'
}
