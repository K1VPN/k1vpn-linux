import { useLanguage } from '../i18n/useLanguage'
import { useState } from 'react'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { TranslationKey } from '../i18n/translations'
import { AppIcon, type IconName } from '../components/AppIcon'
import { getCapabilities } from '../platform/capabilities'

interface MenuItem {
  key: string
  labelKey: TranslationKey
  onSelect: () => void
  icon: IconName
  description: TranslationKey
}

interface Props {
  onBack: () => void
  onAccount: () => void
  onSettings: () => void
  onAbout: () => void
}

export default function MenuScreen({
  onBack,
  onAccount,
  onSettings,
  onAbout
}: Props): React.JSX.Element {
  const { t } = useLanguage()
  const [quitting, setQuitting] = useState(false)
  const [error, setError] = useState('')
  async function quit(): Promise<void> {
    setQuitting(true)
    setError('')
    try {
      await window.api.app.quit()
    } catch (e) {
      setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      // Linux desktop termination may be cancelled by a confirmation dialog.
      setQuitting(false)
    }
  }

  // Add new pages here as they're built — nothing else needs to change to
  // make a new entry show up in the list.
  const items: MenuItem[] = [
    {
      key: 'account',
      labelKey: 'account',
      onSelect: onAccount,
      icon: 'account',
      description: 'accountDescription'
    },
    {
      key: 'settings',
      labelKey: 'settings',
      onSelect: onSettings,
      icon: 'settings',
      description: 'settingsDescription'
    },
    {
      key: 'about',
      labelKey: 'about',
      onSelect: onAbout,
      icon: 'about',
      description: 'aboutDescription'
    }
  ]

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack} disabled={quitting}>
          &larr; {t('back')}
        </button>
        <span className="settings-title">{t('menu')}</span>
      </div>

      <div className="settings-content">
        <div className="page-intro">
          <h1>{t('menuHeading')}</h1>
          <p>{t('menuDescription')}</p>
        </div>
        <div className="menu-list">
          {items.map((item) => (
            <button
              key={item.key}
              className="menu-item"
              onClick={item.onSelect}
              disabled={quitting}
            >
              <span className="menu-item-icon">
                <AppIcon name={item.icon} />
              </span>
              <span className="menu-item-copy">
                <span>{t(item.labelKey)}</span>
                <small>{t(item.description)}</small>
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
          ))}
          {getCapabilities().quit && (
            <button className="menu-item menu-item--quit" onClick={quit} disabled={quitting}>
              <span className="menu-item-copy">
                <span>{t(quitting ? 'quitting' : 'quitApp')}</span>
                <small>{t('quitDescription')}</small>
              </span>
            </button>
          )}
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
