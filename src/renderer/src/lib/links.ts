import type { Language } from '../i18n/translations'

/**
 * The privacy policy on k1vpn.com, in the language of the UI. The Linux host
 * opens this HTTPS URL through its external-browser allowlist, so nothing here
 * loosens application navigation security.
 */
export function privacyPolicyUrl(language: Language): string {
  return language === 'el'
    ? 'https://k1vpn.com/privacy-policy/'
    : 'https://k1vpn.com/en/privacy-policy/'
}

/** The terms of use on k1vpn.com, in the language of the UI (same handling as above). */
export function termsOfUseUrl(language: Language): string {
  return language === 'el' ? 'https://k1vpn.com/terms/' : 'https://k1vpn.com/en/terms/'
}
