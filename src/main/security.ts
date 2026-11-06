import { THIRD_PARTY_LICENSE_URLS } from '../shared/thirdParty'

const EXTERNAL_ORIGINS = new Set(['https://k1vpn.com', 'https://www.k1vpn.com'])

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && (EXTERNAL_ORIGINS.has(url.origin) || THIRD_PARTY_LICENSE_URLS.has(url.href))
  } catch {
    return false
  }
}
