import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ApiProtocolError, ApiUnreachableError, fetchAccount, fetchServers, fetchWireguardConfig, isValidIsoDateTime } from './apiClient'

type FetchArgs = [string, RequestInit]
const account = { id: 9, username: 'k1_42_1', status: 'Active', wg_ip: '10.0.0.5', wg_private_key: 'A'.repeat(43) + '=', wg_public_key: 'B'.repeat(43) + '=', expired_at: null, created: '2017-03-24 19:26:24', updated: '2017-03-28 17:44:21' }
const server = { id: '101', country_code: 'US', country_name: 'United States', city: 'New York', label: null, is_recommended: true, is_featured: false, load_percent: 42 }
const peer = { server_public_key: 'C'.repeat(43) + '=', endpoint: 'vpn.example:51820', allowed_ips: ['0.0.0.0/0', '::/0'], persistent_keepalive: 25, dns: ['1.1.1.1'] }

function response(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status }) }
function stub(impl: (...args: FetchArgs) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl as (...args: unknown[]) => Response | Promise<Response>)
  vi.stubGlobal('fetch', mock)
  return mock
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('K1VPN API client', () => {
  it('uses only the fixed relay and strips ambient web credentials', async () => {
    const mock = stub(() => response(200, { account }))
    await fetchAccount('k1_42_1', 'pw-test')
    const [url, init] = mock.mock.calls[0] as FetchArgs
    expect(url).toBe('https://api.k1vpn.net/desktop/v1/account')
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    expect(JSON.parse(init.body as string)).toEqual({ username: 'k1_42_1', password: 'pw-test' })
  })

  it('rejects redirects without contacting their target', async () => {
    const mock = stub(() => new Response(null, { status: 307, headers: { Location: 'https://evil.example' } }))
    await expect(fetchAccount('user', 'password')).rejects.toBeInstanceOf(ApiProtocolError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('has no host fallback when transport fails', async () => {
    const mock = stub(() => { throw new Error('offline') })
    await expect(fetchAccount('user', 'password')).rejects.toBeInstanceOf(ApiUnreachableError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it.each([502, 503, 504])('normalizes temporary service error %i', async (status) => {
    stub(() => response(status, { error: 'internal detail' }))
    await expect(fetchAccount('user', 'password')).rejects.toEqual(expect.objectContaining({ status, message: 'K1VPN is temporarily unavailable. Please try again shortly.' }))
  })

  it('keeps a bounded backend error on ordinary non-success', async () => {
    stub(() => response(401, { error: 'Invalid credentials.' }))
    await expect(fetchAccount('user', 'wrong')).rejects.toEqual(expect.objectContaining({ name: 'ApiError', status: 401, message: 'Invalid credentials.' }))
  })

  it('caps response bodies', async () => {
    stub(() => new Response('x'.repeat(70 * 1024), { status: 200 }))
    await expect(fetchAccount('user', 'password')).rejects.toBeInstanceOf(ApiProtocolError)
  })

  it('maps account, servers, and peer config', async () => {
    stub((_url) => _url.endsWith('/account') ? response(200, { account }) : _url.endsWith('/servers') ? response(200, { servers: [server] }) : response(200, peer))
    await expect(fetchAccount('user', 'password')).resolves.toMatchObject({ id: 9, wgIp: '10.0.0.5' })
    await expect(fetchServers('user', 'password')).resolves.toEqual([{ id: '101', countryCode: 'US', countryName: 'United States', city: 'New York', label: null, isRecommended: true, isFeatured: false, loadPercent: 42 }])
    await expect(fetchWireguardConfig('user', 'password', '101')).resolves.toMatchObject({ endpoint: 'vpn.example:51820', allowedIps: ['0.0.0.0/0', '::/0'] })
  })

  it('rejects missing nullable keys and malformed bounded values', async () => {
    const { expired_at: _expired, ...missingExpiry } = account
    stub(() => response(200, { account: missingExpiry }))
    await expect(fetchAccount('user', 'password')).rejects.toBeInstanceOf(ApiProtocolError)
    stub(() => response(200, { ...peer, persistent_keepalive: undefined }))
    await expect(fetchWireguardConfig('user', 'password', '101')).rejects.toBeInstanceOf(ApiProtocolError)
  })

  it.each(['2099-02-31T00:00:00Z', '2099-13-01T00:00:00Z', '2099-01-01T24:00:00Z', '2099-01-01T00:00:00+24:00'])('rejects impossible ISO time %s', (value) => {
    expect(isValidIsoDateTime(value)).toBe(false)
  })
  it.each(['2096-02-29T00:00:00Z', '2000-02-29T23:59:59Z', '2099-01-01T00:00:00+14:00'])('accepts valid ISO time %s', (value) => {
    expect(isValidIsoDateTime(value)).toBe(true)
  })

  it('validates request fields before network access', async () => {
    const mock = stub(() => response(200, { account }))
    await expect(fetchAccount(' bad ', 'password')).rejects.toThrow(TypeError)
    await expect(fetchWireguardConfig('user', 'password', '../bad')).rejects.toThrow(TypeError)
    expect(mock).not.toHaveBeenCalled()
  })

  it('ApiError preserves status without raw transport text', () => {
    expect(new ApiError(403, 'Unavailable')).toMatchObject({ status: 403, message: 'Unavailable' })
  })
})
