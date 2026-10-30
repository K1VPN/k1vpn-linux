import { describe, expect, it } from 'vitest'
import { translations } from '../i18n/translations'
import { autoConnectErrorReason } from './autoConnectErrorText'

describe('autoConnectErrorReason', () => {
  it('translates every native auto-connect code into both languages', () => {
    const codes = [
      'AUTH',
      'NETWORK',
      'PROTOCOL',
      'VPN_PERMISSION',
      'SNAP_PERMISSION',
      'VPN',
      'CONFIG',
      'BUSY',
      'SUPERSEDED'
    ]
    const keys = new Set(codes.map(autoConnectErrorReason))
    expect(keys.size).toBe(codes.length)
    expect(keys.has('autoConnectErrorGeneric')).toBe(false)
    for (const key of keys) {
      expect(translations.el[key]).not.toBe(translations.en[key])
    }
  })

  it('falls back to the generic reason for internal, invalid and unknown codes', () => {
    for (const code of ['INTERNAL', 'INVALID_ARGUMENT', 'SOMETHING_NEW', 'toString', '']) {
      expect(autoConnectErrorReason(code)).toBe('autoConnectErrorGeneric')
    }
  })

  it('never shows the English native message in Greek', () => {
    expect(translations.el[autoConnectErrorReason('VPN_PERMISSION')]).not.toContain(
      'VPN permission was not granted'
    )
  })
})
