import { describe, expect, it } from 'vitest'
import { privacyPolicyUrl } from './links'

describe('privacyPolicyUrl', () => {
  it('follows the UI language: Greek at the site root, English under /en', () => {
    expect(privacyPolicyUrl('el')).toBe('https://k1vpn.com/privacy-policy/')
    expect(privacyPolicyUrl('en')).toBe('https://k1vpn.com/en/privacy-policy/')
  })
})
