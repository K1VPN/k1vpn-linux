import { useState } from 'react'
import ThirdPartyScreen from './ThirdPartyScreen'
import { useLanguage } from '../i18n/useLanguage'
import { Brand } from '../components/Brand'
import { privacyPolicyUrl } from '../lib/links'
interface Props { onBack: () => void; serverCount?: number }
export default function AboutScreen({ onBack, serverCount }: Props): React.JSX.Element {
  const { t, language } = useLanguage(); const [licenses, setLicenses] = useState(false); const site = language === 'el' ? 'https://k1vpn.com' : 'https://k1vpn.com/en'
  if (licenses) return <ThirdPartyScreen onBack={() => setLicenses(false)} />
  return <div className="screen settings-screen"><div className="settings-header"><button className="btn-back" onClick={onBack}>&larr; {t('back')}</button><span className="settings-title">{t('about')}</span></div><div className="settings-content"><div className="about-hero"><Brand /><p className="login-tagline">{t('loginTagline')}</p><p className="about-statement">{t('aboutStatement')}</p></div><div className="about-actions"><a className="btn-primary btn-secondary" href={`${site}/dnsleak/`} target="_blank" rel="noreferrer">{t('dnsLeakTest')}</a><a className="btn-primary btn-secondary" href={`${site}/webrtc-leak-test/`} target="_blank" rel="noreferrer">{t('webrtcLeakTest')}</a><a className="btn-primary btn-secondary about-privacy" href={privacyPolicyUrl(language)} target="_blank" rel="noreferrer">{t('privacyPolicy')}</a></div><div className="settings-section"><div className="settings-row"><span className="settings-row-label">{t('serverCount')}</span><span className="settings-row-value">{serverCount ?? '—'}</span></div><div className="settings-row"><span className="settings-row-label">{t('version')}</span><span className="settings-row-value">v{__APP_VERSION__}</span></div></div></div><footer className="login-footer about-footer"><p>{t('aboutTech')}</p><p className="about-copyright"><a href="#licenses" onClick={(event) => { event.preventDefault(); setLicenses(true) }}>{t('licenses')}</a></p><p className="about-copyright">{t('copyright', { year: String(new Date().getFullYear()) })}</p></footer></div>
}
