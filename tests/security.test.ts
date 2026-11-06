import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../src/main/security'
import { THIRD_PARTY_PACKAGES } from '../src/shared/thirdParty'

describe('external URL policy', () => {
  it('allows the exact license pages used by About', () => {
    for (const component of THIRD_PARTY_PACKAGES) {
      for (const license of component.licenses) expect(isAllowedExternalUrl(license.url)).toBe(true)
    }
  })

  it.each([
    'https://k1vpn.com',
    'https://k1vpn.com/download',
    'https://www.k1vpn.com/privacy?source=client'
  ])('allows an approved HTTPS destination: %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    'http://k1vpn.com',
    'https://k1vpn.com.attacker.example',
    'https://attacker.example/?next=https://k1vpn.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://github.com/attacker/project',
    'https://github.com/electron/electron/blob/main/LICENSE?redirect=evil',
    'https://docs.rs/crate/unrelated/1.0.0/source/LICENSE',
    'http://github.com/electron/electron/blob/main/LICENSE',
    'not a URL'
  ])('blocks a non-approved destination: %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })
})
