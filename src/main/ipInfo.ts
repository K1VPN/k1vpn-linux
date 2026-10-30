import https from 'node:https'
import { isIP } from 'node:net'

const HOST = 'iplocate.k1vpn.net'
const PATH = '/v1/client-ip'
const KEY_HEADER = ['X-K1VPN', 'Client-Key'].join('-')
const TIMEOUT_MS = 8_000
const MAX_BYTES = 16 * 1024
declare const __K1VPN_CLIENT_IP_KEY__: string

export interface PublicIpInfo {
  ip: string
  countryCode: string | null
  countryName: string | null
}

export class PublicIpError extends Error {
  constructor(readonly code: 'NOT_CONFIGURED' | 'NETWORK' | 'INVALID_RESPONSE') {
    super('Could not determine the current public IP.')
    this.name = 'PublicIpError'
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null
}

export function parsePublicIpBody(raw: string): PublicIpInfo {
  let body: unknown
  try { body = JSON.parse(raw) } catch { throw new PublicIpError('INVALID_RESPONSE') }
  if (!body || typeof body !== 'object') throw new PublicIpError('INVALID_RESPONSE')
  const value = body as Record<string, unknown>
  if (typeof value.ip !== 'string' || isIP(value.ip) === 0) throw new PublicIpError('INVALID_RESPONSE')
  return {
    ip: value.ip,
    countryCode: optionalString(value.country_code),
    countryName: optionalString(value.country)
  }
}

export function fetchPublicIp(signal?: AbortSignal, key = __K1VPN_CLIENT_IP_KEY__): Promise<PublicIpInfo> {
  if (!key.trim()) return Promise.reject(new PublicIpError('NOT_CONFIGURED'))
  if (signal?.aborted) return Promise.reject(new PublicIpError('NETWORK'))
  return new Promise((resolve, reject) => {
    let complete = false
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1 })
    const finish = (error?: PublicIpError, value?: PublicIpInfo): void => {
      if (complete) return
      complete = true
      clearTimeout(deadline)
      signal?.removeEventListener('abort', onAbort)
      request.destroy()
      agent.destroy()
      error ? reject(error) : resolve(value!)
    }
    const request = https.request({
      host: HOST,
      path: PATH,
      method: 'GET',
      headers: { Accept: 'application/json', [KEY_HEADER]: key, Connection: 'close' },
      agent
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        finish(new PublicIpError('INVALID_RESPONSE'))
        return
      }
      let raw = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_BYTES) finish(new PublicIpError('INVALID_RESPONSE'))
        else raw += chunk
      })
      response.once('aborted', () => finish(new PublicIpError('NETWORK')))
      response.once('error', () => finish(new PublicIpError('NETWORK')))
      response.once('end', () => {
        if (complete) return
        try { finish(undefined, parsePublicIpBody(raw)) } catch { finish(new PublicIpError('INVALID_RESPONSE')) }
      })
    })
    const onAbort = (): void => finish(new PublicIpError('NETWORK'))
    signal?.addEventListener('abort', onAbort, { once: true })
    request.once('error', () => finish(new PublicIpError('NETWORK')))
    const deadline = setTimeout(() => finish(new PublicIpError('NETWORK')), TIMEOUT_MS)
    request.end()
  })
}
