import { useState } from 'react'
import { useLanguage } from '../i18n/useLanguage'
import { privacyPolicyUrl } from '../lib/links'
import { Brand } from '../components/Brand'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { getCapabilities } from '../platform/capabilities'

interface Props {
  onAccept: () => void
}

/**
 * What the VPN does with the user's data, shown before every manual Linux sign-in.
 * Accept continues to the login screen and decline closes the application.
 * Nothing is stored either way: the notice returns whenever manual sign-in is needed.
 */
export default function VpnNoticeScreen({ onAccept }: Props): React.JSX.Element {
  const { t, language } = useLanguage()
  const [closing, setClosing] = useState(false)
  const [declined, setDeclined] = useState(false)

  async function decline(): Promise<void> {
    if (!getCapabilities().declineClosesApp) {
      setDeclined(true)
      return
    }
    setClosing(true)
    try {
      await window.api.app.quit()
    } catch (e) {
      console.error('closing the app failed:', e)
      setClosing(false)
    }
  }

  if (declined) {
    return (
      <div className="screen login-screen">
        <LanguageSwitch />
        <div className="login-branding">
          <Brand />
        </div>
        <div className="login-panel vpn-notice" role="alert">
          <h1 className="vpn-notice-title">{t('vpnNoticeBlockedTitle')}</h1>
          <p className="vpn-notice-text">{t('vpnNoticeBlockedText')}</p>
          <button className="btn-primary" type="button" onClick={() => setDeclined(false)}>
            {t('back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen login-screen">
      <LanguageSwitch />
      <div className="login-branding">
        <Brand />
      </div>
      <div className="login-panel vpn-notice">
        <h1 className="vpn-notice-title">{t('vpnNoticeTitle')}</h1>
        <p className="vpn-notice-text">{t('vpnNoticeIntro')}</p>
        <ul className="vpn-notice-list">
          <li>{t('vpnNoticeCredentials')}</li>
          <li>{t('vpnNoticeIp')}</li>
          <li>{t('vpnNoticeIpLookup')}</li>
          <li>{t('vpnNoticeSessionIp')}</li>
          <li>{t('vpnNoticeServers')}</li>
          <li>{t('vpnNoticeNoAds')}</li>
        </ul>
        <p className="vpn-notice-text">
          {t('vpnNoticeMore')}{' '}
          <a href={privacyPolicyUrl(language)} target="_blank" rel="noreferrer">
            {t('privacyPolicy')}
          </a>
          .
        </p>
        <button className="btn-primary" type="button" onClick={onAccept} disabled={closing}>
          {t('vpnNoticeAccept')}
        </button>
        <button className="btn-back" type="button" onClick={decline} disabled={closing}>
          {t('vpnNoticeDecline')}
        </button>
      </div>
    </div>
  )
}
