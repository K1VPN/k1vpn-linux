import type { TranslationKey } from '../i18n/translations'
import type { DnsMode } from '../../../shared/dns'

export const DNS_LABELS: Record<DnsMode, TranslationKey> = {
  default: 'dnsDefault',
  cloudflare: 'dnsCloudflare',
  quad9: 'dnsQuad9',
  google: 'dnsGoogle',
  custom: 'dnsCustom'
}
