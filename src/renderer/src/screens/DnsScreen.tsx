import { useLanguage } from '../i18n/useLanguage'
import { useEffect, useState } from 'react'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { DNS_LABELS } from '../lib/dnsLabels'
import type { TranslationKey } from '../i18n/translations'
import { DNS_MODES, MAX_CUSTOM_DNS, customDnsProblem, type DnsMode } from '../../../shared/dns'

interface Props {
  onBack: () => void
}

type Preferences = Awaited<ReturnType<typeof window.api.settings.get>>

const emptyEntries = (): string[] => Array.from({ length: MAX_CUSTOM_DNS }, () => '')

export default function DnsScreen({ onBack }: Props): React.JSX.Element {
  const { t } = useLanguage()
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState<DnsMode>('default')
  const [entries, setEntries] = useState<string[]>(emptyEntries)
  const [entriesError, setEntriesError] = useState<TranslationKey | ''>('')

  function apply(value: Preferences): void {
    setChoice(value.dns.mode)
    setEntries(Array.from({ length: MAX_CUSTOM_DNS }, (_, i) => value.dns.custom[i] ?? ''))
    setLoaded(true)
  }

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .get()
      .then((value) => {
        if (!cancelled) apply(value)
      })
      .catch((e) => {
        if (!cancelled) setError(cleanIpcErrorMessage(String(e.message)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save(mode: DnsMode, custom: string[]): Promise<void> {
    setBusy(true)
    setError('')
    try {
      apply(await window.api.settings.setDns(mode, custom))
    } catch (e) {
      setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  function choose(mode: DnsMode): void {
    setEntriesError('')
    setChoice(mode)
    if (mode !== 'custom') void save(mode, [])
  }

  function saveCustom(): void {
    const list = entries.map((entry) => entry.trim()).filter((entry) => entry !== '')
    if (list.length === 0) return setEntriesError('dnsCustomRequired')
    for (const entry of list) {
      const problem = customDnsProblem(entry)
      if (problem) {
        return setEntriesError(
          problem === 'invalid'
            ? 'dnsInvalid'
            : problem === 'ipv4Only'
              ? 'dnsIpv4Only'
              : 'dnsNotPublic'
        )
      }
    }
    setEntriesError('')
    void save('custom', list)
  }

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack}>
          &larr; {t('back')}
        </button>
        <span className="settings-title">{t('dnsProvider')}</span>
      </div>

      <div className="settings-content">
        <p className="dns-intro">{t('dnsHint')}</p>
        <div className="settings-section" role="radiogroup" aria-label={t('dnsProvider')}>
          {DNS_MODES.map((mode) => (
            <label className="settings-row dns-option" key={mode}>
              <span>{t(DNS_LABELS[mode])}</span>
              <input
                type="radio"
                name="dns-provider"
                value={mode}
                checked={choice === mode}
                disabled={!loaded || busy}
                onChange={() => choose(mode)}
                className="startup-setting-toggle"
              />
            </label>
          ))}
        </div>
        {choice === 'custom' && (
          <div className="dns-custom">
            <small>{t('dnsCustomHint')}</small>
            {entries.map((entry, index) => (
              <input
                key={index}
                className="form-input"
                type="text"
                inputMode="decimal"
                spellCheck={false}
                autoComplete="off"
                value={entry}
                disabled={busy}
                placeholder={t(index === 0 ? 'dnsPrimary' : 'dnsSecondary')}
                aria-label={t(index === 0 ? 'dnsPrimary' : 'dnsSecondary')}
                onChange={(e) => {
                  setEntriesError('')
                  setEntries((current) =>
                    current.map((value, i) => (i === index ? e.target.value : value))
                  )
                }}
              />
            ))}
            {entriesError && (
              <div className="form-error" role="alert">
                {t(entriesError)}
              </div>
            )}
            <button type="button" className="btn-primary" disabled={busy} onClick={saveCustom}>
              {t('saveDns')}
            </button>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
