import { describe, expect, it } from 'vitest'
import { VpnDaemonError, daemonSocketPath, parseDaemonResponse } from './daemonClient'

describe('daemon protocol response validation', () => {
  it('accepts a matching successful response', () => {
    expect(parseDaemonResponse('{"v":1,"id":4,"ok":true,"result":{"state":"disconnected"}}', 4)).toEqual({ state: 'disconnected' })
  })

  it.each([
    ['not json', 'invalid_response'],
    ['{"v":2,"id":4,"ok":true}', 'invalid_response'],
    ['{"v":1,"id":5,"ok":true}', 'invalid_response'],
    ['{"v":1,"id":4,"ok":false}', 'invalid_response']
  ])('rejects malformed or mismatched responses', (raw, code) => {
    expect(() => parseDaemonResponse(raw, 4)).toThrowError(expect.objectContaining({ code }))
  })

  it('preserves a structured daemon error', () => {
    expect(() => parseDaemonResponse('{"v":1,"id":4,"ok":false,"error":{"code":"busy","message":"try later"}}', 4)).toThrowError(new VpnDaemonError('busy', 'try later'))
  })
})

describe('daemon socket location', () => {
  it('uses the fixed system socket outside a snap', () => {
    expect(daemonSocketPath({})).toBe('/run/k1vpn/k1vpnd.sock')
  })

  it('uses the fixed snap socket and ignores path-like variables', () => {
    expect(daemonSocketPath({ SNAP_NAME: 'k1vpn', SNAP_COMMON: '/tmp/evil' })).toBe('/var/snap/k1vpn/common/run/k1vpnd.sock')
  })

  it('does not treat another snap as the k1vpn layout', () => {
    expect(daemonSocketPath({ SNAP_NAME: 'other' })).toBe('/run/k1vpn/k1vpnd.sock')
  })
})
