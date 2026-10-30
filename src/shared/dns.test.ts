import { describe, expect, it } from 'vitest'
import {
  DNS_PRESETS,
  customDnsProblem,
  effectiveDns,
  normalizeCustomDns,
  validateDnsSettings
} from './dns'

describe('customDnsProblem', () => {
  it.each(['1.1.1.1', '9.9.9.9', '208.67.222.222'])('accepts the public address %s', (ip) =>
    expect(customDnsProblem(ip)).toBeNull()
  )

  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.1.1',
    '224.0.0.251',
    '255.255.255.255'
  ])('rejects the local or private IPv4 address %s', (ip) =>
    expect(customDnsProblem(ip)).toBe('notPublic')
  )

  it.each(['::', '::1', 'fe80::1', 'fd00::1', 'ff02::fb', '::ffff:1.1.1.1'])(
    'rejects the IPv6 address %s because the tunnel is IPv4-only',
    (ip) => expect(customDnsProblem(ip)).toBe('ipv4Only')
  )

  it.each([
    'dns.example.com',
    '1.1.1',
    '1.1.1.1.1',
    '1.1.1.256',
    '01.1.1.1',
    '1.1.1.1:53',
    '1.1.1.1/32',
    '[2606:4700:4700::1111]',
    'fe80::1%12',
    '2606:4700:4700::1111::1',
    '1:2:3:4:5:6:7:8:9',
    '2606:4700:4700:0:0:0:0:0:1111',
    'abcd::efgh',
    ''
  ])('rejects the malformed entry %j', (entry) => expect(customDnsProblem(entry)).toBe('invalid'))

  it('172.15 and 172.32 are public, 100.63 and 100.128 are public', () => {
    for (const ip of ['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1'])
      expect(customDnsProblem(ip)).toBeNull()
  })

  it('rejects IPv6 because the current tunnel is IPv4-only', () => {
    expect(customDnsProblem('2606:4700:4700:0:0:0:0:1111')).toBe('ipv4Only')
    expect(customDnsProblem('0:0:0:0:0:0:0:1')).toBe('ipv4Only')
    expect(customDnsProblem('0:0:0:0:0:ffff:0101:0101')).toBe('ipv4Only')
  })
})

describe('normalizeCustomDns', () => {
  it('trims, drops blanks and duplicates', () => {
    expect(normalizeCustomDns([' 1.1.1.1 ', '', '1.1.1.1', '9.9.9.9'])).toEqual([
      '1.1.1.1',
      '9.9.9.9'
    ])
  })
  it('fails on the first bad entry instead of skipping it', () => {
    expect(() => normalizeCustomDns(['1.1.1.1', 'nope'])).toThrow('not a valid IP')
    expect(() => normalizeCustomDns(['192.168.1.2'])).toThrow('local or private')
  })
  it('limits the list length and rejects non-lists', () => {
    expect(() => normalizeCustomDns(['1.1.1.1', '9.9.9.9', '8.8.8.8'])).toThrow('at most')
    expect(() => normalizeCustomDns('1.1.1.1')).toThrow()
    expect(() => normalizeCustomDns([1])).toThrow()
  })
})

describe('validateDnsSettings', () => {
  it('accepts every preset and forgets any leftover custom list', () => {
    for (const mode of ['default', 'cloudflare', 'quad9', 'google'] as const)
      expect(validateDnsSettings(mode, ['8.8.8.8'])).toEqual({ mode, custom: [] })
  })
  it('requires a valid, non-empty list for custom', () => {
    expect(validateDnsSettings('custom', ['1.1.1.1'])).toEqual({
      mode: 'custom',
      custom: ['1.1.1.1']
    })
    expect(() => validateDnsSettings('custom', [])).toThrow('at least one')
    expect(() => validateDnsSettings('custom', ['', ' '])).toThrow('at least one')
    expect(() => validateDnsSettings('custom', undefined)).toThrow('at least one')
    expect(() => validateDnsSettings('custom', ['127.0.0.1'])).toThrow()
  })
  it('rejects unknown modes', () => {
    expect(() => validateDnsSettings('opendns', [])).toThrow('Invalid DNS provider')
    expect(() => validateDnsSettings(undefined, [])).toThrow()
  })
})

describe('effectiveDns', () => {
  it('uses the provider list in default mode and nothing when it has none', () => {
    expect(effectiveDns({ mode: 'default', custom: [] }, ['172.16.0.1'])).toEqual(['172.16.0.1'])
    expect(effectiveDns({ mode: 'default', custom: [] }, null)).toEqual([])
  })
  it('uses the built-in servers for each provider regardless of the provider list', () => {
    for (const mode of ['cloudflare', 'quad9', 'google'] as const)
      expect(effectiveDns({ mode, custom: [] }, ['172.16.0.1'])).toEqual([...DNS_PRESETS[mode]])
  })
  it('uses the typed servers in custom mode', () => {
    expect(effectiveDns({ mode: 'custom', custom: ['9.9.9.9'] }, ['172.16.0.1'])).toEqual([
      '9.9.9.9'
    ])
  })
  it('returns a copy, never the shared preset array', () => {
    const list = effectiveDns({ mode: 'google', custom: [] }, null)
    list.push('1.2.3.4')
    expect(effectiveDns({ mode: 'google', custom: [] }, null)).toEqual([
      '94.140.14.15',
      '94.140.15.16'
    ])
  })
  it('every preset entry is itself an acceptable public address', () => {
    for (const servers of Object.values(DNS_PRESETS))
      for (const ip of servers) expect(customDnsProblem(ip)).toBeNull()
  })
})
