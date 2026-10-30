import { describe, expect, it } from 'vitest'
import { TunnelConfigError, isWireguardKey, validateTunnelConfig, type AccountSecrets } from './tunnelConfig'
import type { WireguardPeerConfig } from './apiClient'

const key = (byte: number): string => Buffer.alloc(32, byte).toString('base64')
const secrets = (ip: string | null = '10.8.0.2', privateValue: string | null = key(1)): AccountSecrets => ({ wgIp: ip, wgPrivateKey: privateValue, wgPublicKey: key(2) })
const peer = (overrides: Partial<WireguardPeerConfig> = {}): WireguardPeerConfig => ({ serverPublicKey: key(3), endpoint: 'vpn.example.com:51820', allowedIps: ['0.0.0.0/0'], persistentKeepalive: null, dns: ['10.8.0.1'], ...overrides })

describe('tunnel configuration validation', () => {
  it('accepts canonical full-tunnel configuration and blocks the unsupported family', () => {
    expect(validateTunnelConfig(secrets(), peer(), ['10.8.0.1'])).toEqual({
      privateKey: key(1), address: '10.8.0.2', addressFamily: 4, peerPublicKey: key(3),
      endpointHost: 'vpn.example.com', endpointPort: 51820, allowedIps: ['0.0.0.0/0'],
      dns: ['10.8.0.1'], persistentKeepalive: null, blockIpv4: false, blockIpv6: true
    })
  })

  it('retains only the assigned family routes and blocks the other family', () => {
    const result = validateTunnelConfig(secrets(), peer({ allowedIps: ['0.0.0.0/0', '::/0'] }), ['1.1.1.1'])
    expect(result.allowedIps).toEqual(['0.0.0.0/0'])
    expect(result.blockIpv6).toBe(true)
  })

  it('supports IPv6 identity and bracketed IPv6 endpoints', () => {
    const result = validateTunnelConfig(secrets('fd00::2'), peer({ endpoint: '[2001:db8::1]:51820', allowedIps: ['::/0', '0.0.0.0/0'], dns: ['fd00::1'] }), ['fd00::1'])
    expect(result).toMatchObject({ addressFamily: 6, endpointHost: '2001:db8::1', allowedIps: ['::/0'], blockIpv4: true, blockIpv6: false })
  })

  it.each([
    [secrets(null), peer(), ['10.8.0.1'], 'MISSING_IDENTITY'],
    [secrets('10.8.0.2', 'bad'), peer(), ['10.8.0.1'], 'INVALID_PRIVATE_KEY'],
    [secrets(), peer({ serverPublicKey: 'bad' }), ['10.8.0.1'], 'INVALID_PEER_KEY'],
    [secrets('not-an-ip'), peer(), ['10.8.0.1'], 'INVALID_ADDRESS'],
    [secrets(), peer({ endpoint: 'host-without-port' }), ['10.8.0.1'], 'INVALID_ENDPOINT'],
    [secrets(), peer({ allowedIps: ['10.0.0.0/8'] }), ['10.8.0.1'], 'NO_FULL_TUNNEL'],
    [secrets(), peer({ allowedIps: ['bad'] }), ['10.8.0.1'], 'INVALID_ALLOWED_IP'],
    [secrets(), peer(), ['127.0.0.1'], 'INVALID_DNS'],
    [secrets('fd00::2'), peer({ allowedIps: ['::/0'] }), ['8.8.8.8'], 'NO_USABLE_DNS']
  ] as const)('rejects unsafe config with stable code', (account, config, dns, code) => {
    expect(() => validateTunnelConfig(account, config, dns)).toThrowError(expect.objectContaining({ code }))
  })

  it('accepts provider-private DNS when routed and deduplicates it', () => {
    expect(validateTunnelConfig(secrets(), peer(), ['10.8.0.1', '10.8.0.1']).dns).toEqual(['10.8.0.1'])
  })

  it('accepts only canonical 32-byte WireGuard keys', () => {
    expect(isWireguardKey(key(7))).toBe(true)
    expect(isWireguardKey(Buffer.alloc(16).toString('base64'))).toBe(false)
    expect(isWireguardKey(`${key(7)}=`)).toBe(false)
  })

  it('validates ports and hostnames strictly', () => {
    for (const endpoint of ['vpn.example:0', 'vpn.example:65536', '-bad.example:51820', '[::1]51820', '::1:51820']) {
      expect(() => validateTunnelConfig(secrets(), peer({ endpoint }), ['10.8.0.1'])).toThrowError(TunnelConfigError)
    }
  })
})
