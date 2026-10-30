import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/updates'
import { useLanguage } from '../i18n/useLanguage'

export function UpdatePanel(): React.JSX.Element {
  const { language } = useLanguage()
  const el = language === 'el'
  const [state, setState] = useState<UpdateState>({ status: 'idle', current: __APP_VERSION__ })
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.api.updates
        .get()
        .then((value) => {
          if (active) setState(value)
        })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const messages: Record<UpdateState['status'], string> = {
    disabled: el
      ? 'Τα updates λειτουργούν στην εγκατεστημένη εφαρμογή.'
      : 'Updates are available in the installed app.',
    idle: '',
    checking: el ? 'Έλεγχος ενημερώσεων...' : 'Checking for updates...',
    'up-to-date': el ? 'Έχετε την πιο πρόσφατη έκδοση.' : 'You are up to date.',
    downloading: `${el ? 'Λήψη' : 'Downloading'} v${state.latest}${state.percent == null ? '' : ` - ${state.percent}%`}`,
    ready: `${el ? 'Έτοιμη για εγκατάσταση' : 'Ready to install'}: v${state.latest}`,
    installing: el ? 'Προετοιμασία εγκατάστασης...' : 'Preparing installation...',
    error: el
      ? 'Η ενημέρωση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.'
      : 'The update could not complete. Please try again.'
  }
  const busy = ['disabled', 'checking', 'downloading', 'installing'].includes(state.status)
  async function action(): Promise<void> {
    try {
      setState(
        await (state.status === 'ready' ? window.api.updates.install() : window.api.updates.check())
      )
    } catch {
      setState((value) => ({ ...value, status: 'error' }))
    }
  }
  return (
    <div className="settings-row">
      <div className="settings-row-label" role="status" aria-live="polite">
        {messages[state.status]}
        {state.status === 'downloading' && state.percent != null && (
          <progress
            max={100}
            value={state.percent ?? 0}
            aria-label={el ? 'Λήψη ενημέρωσης' : 'Update download'}
          />
        )}
        {state.error === 'install' && (
          <p>
            {el
              ? 'Η εγκατάσταση ακυρώθηκε ή απέτυχε. Μπορείτε να ξαναδοκιμάσετε.'
              : 'Installation was cancelled or failed. You can try again.'}
          </p>
        )}
      </div>
      <button
        type="button"
        className="btn-primary btn-secondary btn-compact"
        disabled={busy}
        onClick={() => void action()}
      >
        {state.status === 'ready'
          ? el
            ? 'Εγκατάσταση'
            : 'Install update'
          : el
            ? 'Έλεγχος'
            : 'Check updates'}
      </button>
    </div>
  )
}
