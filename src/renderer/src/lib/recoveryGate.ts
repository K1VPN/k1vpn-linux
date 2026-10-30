import type { HealthDisplay } from '../../../shared/connectionHealth'

export type GateState = 'checking' | 'ready' | 'blocked' | 'unavailable' | 'working'

/**
 * What the recovery gate shows for a connection state. Only a state that says the service is
 * answering and no kill switch is waiting lets the app through; NO INTERNET is such a state (the
 * service answers, the tunnel is fine), while "blocked" and "unknown" are never hidden by it.
 */
export function gateState(display: HealthDisplay, working: boolean): GateState {
  if (working) return 'working'
  switch (display) {
    case 'checking':
      return 'checking'
    case 'blocked':
      return 'blocked'
    case 'unknown':
      return 'unavailable'
    default:
      return 'ready'
  }
}
