import { afterEach, describe, expect, it, vi } from 'vitest'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { PublicIpError, parsePublicIpBody, fetchPublicIp } from './ipInfo'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('gives distant VPN exits time to connect without changing global socket defaults', async () => {
  vi.useFakeTimers()
  const request = new EventEmitter() as EventEmitter & { end(): void; destroy(): void }
  request.destroy = vi.fn()
  const requestMock = vi.spyOn(https, 'request').mockImplementation(((options: https.RequestOptions, callback: (response: unknown) => void) => {
    expect((options.agent as https.Agent).options).toMatchObject({ autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 1500 })
    request.end = () => {
      setTimeout(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; setEncoding(): void }
        response.statusCode = 200
        response.setEncoding = () => {}
        callback(response)
        response.emit('data', '{"ip":"203.0.113.7"}')
        response.emit('end')
      }, 1200)
    }
    return request
  }) as typeof https.request)
  const result = fetchPublicIp(undefined, 'dummy-test-key')
  await vi.advanceTimersByTimeAsync(1200)
  await expect(result).resolves.toMatchObject({ ip: '203.0.113.7' })
  expect(requestMock).toHaveBeenCalledOnce()
  expect(request.destroy).toHaveBeenCalledOnce()
})

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
