import { LANGUAGES } from '../i18n/translations'
import { useLanguage } from '../i18n/useLanguage'

/**
 * Language choice on the screens shown before sign-in (VPN notice, login), where the
 * Settings screen is not reachable yet. Same stored preference as Settings' own
 * language selector (LanguageContext).
 */
export function LanguageSwitch(): React.JSX.Element {
  const { t, language, setLanguage } = useLanguage()
  return (
    <div className="language-switch" role="group" aria-label={t('language')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          className={
            language === l.code
              ? 'language-switch-option language-switch-option--active'
              : 'language-switch-option'
          }
          aria-pressed={language === l.code}
          onClick={() => setLanguage(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
