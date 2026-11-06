import { useLanguage } from '../i18n/useLanguage'
import { THIRD_PARTY_PACKAGES } from '../../../shared/thirdParty'

export default function ThirdPartyScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack}>&larr; {t('back')}</button>
        <span className="settings-title">{t('licenses')}</span>
      </div>
      <div className="settings-content">
        <dl className="about-licenses">
          {THIRD_PARTY_PACKAGES.map(component => (
            <div className="about-license-row" key={component.name}>
              <dt>{component.name}</dt>
              <dd>
                {component.licenses.map((license, index) => (
                  <span key={license.url}>
                    {index > 0 && ' / '}
                    <a href={license.url} target="_blank" rel="noreferrer" aria-label={`${component.name} — ${license.name}`}>
                      {license.name}
                    </a>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
