import { VpnAccount } from '../types'
import { useEffect, useState } from 'react'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { useLanguage } from '../i18n/useLanguage'

interface Props {
  account: VpnAccount
  onBack: () => void
  onLogout: () => Promise<void>
  onRefresh: () => Promise<VpnAccount>
}

// Both API date shapes seen in practice ("2026-06-02 20:04:21" for
// created/updated, full ISO with an offset for expiredAt) parse fine via
// the Date constructor for *display* purposes — this isn't the strict
// calendar validation the backend already does before this value ever
// reaches the renderer (see apiClient.ts's own isValidIsoDateTime), just a
// human-readable rendering of an already-trusted string. Falls back to the
// raw value if it somehow doesn't parse, rather than showing nothing.
function formatDate(value: string | null, neverLabel: string, language: string): string {
  if (!value) return neverLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(language === 'el' ? 'el-GR' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function AccountScreen({
  account,
  onBack,
  onLogout,
  onRefresh
}: Props): React.JSX.Element {
  const { t, language } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Refreshes the account when the screen opens. The result decides what is shown: an error
  // after a failed refresh, none after a successful one. State is only set once the refresh has
  // answered (never synchronously in the effect), and not at all after the screen has gone.
  useEffect(() => {
    let current = true
    void (async () => {
      try {
        await onRefresh()
        if (current) setError('')
      } catch (e) {
        if (current) setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
      }
    })()
    return () => {
      current = false
    }
  }, [onRefresh])
  async function signOut(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await onLogout()
    } catch (e) {
      setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack} disabled={busy}>
          &larr; {t('back')}
        </button>
        <span className="settings-title">{t('account')}</span>
      </div>

      <div className="settings-content">
        <div className="page-intro">
          <h1>{account.username}</h1>
          <p>{t('accountDescription')}</p>
        </div>
        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-row-label">{t('status')}</span>
            <span
              className={`status-badge status-badge--${account.isActive ? 'active' : 'inactive'}`}
            >
              {t(account.isActive ? 'accountActive' : 'accountInactive')}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t('created')}</span>
            <span className="settings-row-value">
              {formatDate(account.createdAt, t('never'), language)}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t('modified')}</span>
            <span className="settings-row-value">
              {formatDate(account.updatedAt, t('never'), language)}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{t('expires')}</span>
            <span className="settings-row-value">
              {formatDate(account.expiredAt, t('never'), language)}
            </span>
          </div>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn-danger" onClick={signOut} disabled={busy}>
          {t(busy ? 'endingSession' : 'signOut')}
        </button>
      </div>
    </div>
  )
}
