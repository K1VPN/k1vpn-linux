import { describe, expect, it } from 'vitest'
import { PublicIpError, parsePublicIpBody } from './ipInfo'

describe('public IP response validation', () => {
  it('accepts a bounded IP result', () => {
    expect(parsePublicIpBody('{"ip":"203.0.113.4","country_code":"GR","country":"Greece"}')).toEqual({
      ip: '203.0.113.4', countryCode: 'GR', countryName: 'Greece'
    })
  })

  it('rejects malformed JSON and non-IP values', () => {
    for (const value of ['not-json', '{}', '{"ip":"example.com"}']) {
      expect(() => parsePublicIpBody(value)).toThrow(PublicIpError)
    }
  })

  it('drops malformed optional location fields', () => {
    expect(parsePublicIpBody('{"ip":"2001:db8::1","country_code":"","country":7}')).toEqual({
      ip: '2001:db8::1', countryCode: null, countryName: null
    })
  })
})
