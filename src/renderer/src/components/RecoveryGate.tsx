import { useState, type ReactNode } from 'react'
import { useLanguage } from '../i18n/useLanguage'
import { Brand } from './Brand'
import { getCapabilities } from '../platform/capabilities'
import { getHealthStore, useHealth } from '../lib/useHealth'
import { gateState } from '../lib/recoveryGate'

/**
 * Keeps recovery available before login: online authentication cannot work through a retained
 * kill switch. It reads the same shared connection state as every other surface (no loop of its
 * own), and only an explicit click ever removes protection.
 */
export function RecoveryGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useLanguage()
  const health = useHealth()
  const [working, setWorking] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const state = gateState(health.display, working)
  // The children mount once the service has answered for the first time and then stay mounted.
  if (state === 'ready' && !initialized) setInitialized(true)

  async function act(): Promise<void> {
    if (state !== 'blocked' && state !== 'unavailable') return
    setWorking(true)
    try {
      await getHealthStore().recover(state === 'blocked' ? 'release' : 'restart')
    } finally {
      setWorking(false)
    }
  }

  const blocked = state === 'blocked'
  const busy = state === 'checking' || state === 'working'
  return (
    <>
      <div className="recovery-content" hidden={state !== 'ready'}>
        {initialized ? children : null}
      </div>
      {state !== 'ready' && (
        <div className="screen login-screen recovery-screen">
          <Brand />
          <div className="recovery-message">
            <h1 className="recovery-title" role="status">
              {t(busy ? 'startingApp' : blocked ? 'recoveryBlocked' : 'recoveryUnavailable')}
            </h1>
            {/* Linux can restart its networking service or release retained protection. */}
            {!busy && (blocked || getCapabilities().serviceRestart) && (
              <>
                <p className="recovery-description">
                  {t(blocked ? 'recoveryReleaseHint' : 'recoveryRestartHint')}
                </p>
                <button className="btn-primary recovery-action" onClick={() => void act()}>
                  {t(blocked ? 'recoveryRelease' : 'recoveryRestart')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
