import { useLanguage } from '../i18n/useLanguage'
import { useEffect, useState } from 'react'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { DNS_LABELS } from '../lib/dnsLabels'
import { LANGUAGES, Language } from '../i18n/translations'
import { getCapabilities } from '../platform/capabilities'

interface Props {
  onBack: () => void
  onDns: () => void
}

type Preferences = Awaited<ReturnType<typeof window.api.settings.get>>

export default function SettingsScreen({ onBack, onDns }: Props): React.JSX.Element {
  const { t, language, setLanguage } = useLanguage()
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    window.api.settings
      .get()
      .then((value) => {
        if (!cancelled) setPreferences(value)
      })
      .catch((e) => {
        if (!cancelled) setError(cleanIpcErrorMessage(String(e.message)))
      })
    return () => {
      cancelled = true
    }
  }, [])
  async function change(
    key: 'autoStart' | 'autoConnect' | 'killSwitch' | 'allowLocalNetwork',
    value: boolean
  ): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setPreferences(await window.api.settings.set(key, value))
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? e.code : null
      setError(
        code === 'LOGIN_ITEM_APPROVAL'
          ? t('loginItemApprovalRequired')
          : code === 'LOGIN_ITEM'
            ? t('loginItemFailed')
            : cleanIpcErrorMessage(e instanceof Error ? e.message : String(e))
      )
    } finally {
      setBusy(false)
    }
  }

  const dnsSummary = preferences
    ? preferences.dns.mode === 'custom'
      ? preferences.dns.custom.join(', ')
      : t(DNS_LABELS[preferences.dns.mode])
    : ''

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack}>
          &larr; {t('back')}
        </button>
        <span className="settings-title">{t('settings')}</span>
      </div>

      <div className="settings-content">
        <div className="settings-flat">
          <div className="settings-row">
            <span className="settings-row-label">{t('language')}</span>
            <select
              className="form-select settings-row-select"
              value={language}
              aria-label={t('language')}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          {(['autoStart', 'autoConnect', 'killSwitch'] as const)
            .filter((key) => {
              const caps = getCapabilities()
              return key === 'autoStart'
                ? caps.autoStart
                : key === 'autoConnect'
                  ? caps.autoConnect
                  : caps.killSwitchToggle
            })
            .map((key) => (
              <label className="settings-row" key={key}>
                <span className="startup-setting-copy">
                  <span>{t(key)}</span>
                  <small>
                    {t(
                      key === 'autoStart'
                        ? 'autoStartHint'
                        : key === 'autoConnect'
                          ? getCapabilities().systemVpnProtection
                            ? 'autoConnectSystemHint'
                            : 'autoConnectHint'
                          : getCapabilities().systemVpnProtection
                            ? 'killSwitchSystemHint'
                            : 'killSwitchHint'
                    )}
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={preferences?.[key] ?? false}
                  disabled={!preferences || busy}
                  onChange={(e) => {
                    void change(key, e.target.checked)
                  }}
                  aria-label={t(key)}
                  className="startup-setting-toggle"
                />
              </label>
            ))}
          {getCapabilities().localNetworkAccessToggle && (
            <label className="settings-row">
              <span className="startup-setting-copy">
                <span>{t('allowLocalNetwork')}</span>
                <small>{t('allowLocalNetworkHint')}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={preferences?.allowLocalNetwork ?? false}
                disabled={!preferences || busy || !preferences.killSwitch}
                onChange={(e) => {
                  void change('allowLocalNetwork', e.target.checked)
                }}
                aria-label={t('allowLocalNetwork')}
                className="startup-setting-toggle"
              />
            </label>
          )}
          <button className="settings-row settings-link" onClick={onDns}>
            <span className="startup-setting-copy">
              <span>{t('dnsProvider')}</span>
              <small>{dnsSummary || ' '}</small>
            </span>
            <svg
              className="menu-item-chevron"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
