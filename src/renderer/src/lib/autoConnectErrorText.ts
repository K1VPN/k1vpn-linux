import type { TranslationKey } from '../i18n/translations'

/**
 * Maps a stable Linux auto-connect failure code to a translated reason. The service message is
 * deliberately never shown; unknown
 * codes, `INTERNAL` and `INVALID_ARGUMENT` fall back to the generic reason.
 */
const REASONS: Record<string, TranslationKey> = {
  AUTH: 'autoConnectErrorAuth',
  NETWORK: 'autoConnectErrorNetwork',
  PROTOCOL: 'autoConnectErrorProtocol',
  VPN_PERMISSION: 'autoConnectErrorVpnPermission',
  SNAP_PERMISSION: 'autoConnectErrorSnapPermission',
  VPN: 'autoConnectErrorVpn',
  CONFIG: 'autoConnectErrorConfig',
  BUSY: 'autoConnectErrorBusy',
  SUPERSEDED: 'autoConnectErrorSuperseded'
}

export function autoConnectErrorReason(code: string): TranslationKey {
  return Object.prototype.hasOwnProperty.call(REASONS, code)
    ? REASONS[code]
    : 'autoConnectErrorGeneric'
}
