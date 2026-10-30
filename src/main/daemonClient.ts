import { createConnection } from 'node:net'

const PROTOCOL_VERSION = 1
const SYSTEM_SOCKET_PATH = '/run/k1vpn/k1vpnd.sock'
const SNAP_SOCKET_PATH = '/var/snap/k1vpn/common/run/k1vpnd.sock'
const MAX_RESPONSE_BYTES = 16 * 1024
const MAX_REQUEST_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MS = 2_000
const MUTATION_TIMEOUT_MS = 65_000
const VERIFY_TIMEOUT_MS = 6_000
let nextId = 1

interface DaemonErrorBody { code: string; message: string }
interface DaemonResponse { v: number; id: number; ok: boolean; result?: unknown; error?: DaemonErrorBody }

export class VpnDaemonError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'VpnDaemonError'
  }
}

export function parseDaemonResponse(raw: string, expectedId: number): unknown {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new VpnDaemonError('invalid_response', 'The VPN service returned invalid JSON.') }
  if (!value || typeof value !== 'object') throw new VpnDaemonError('invalid_response', 'The VPN service returned an invalid response.')
  const response = value as Partial<DaemonResponse>
  if (response.v !== PROTOCOL_VERSION || response.id !== expectedId || typeof response.ok !== 'boolean') {
    throw new VpnDaemonError('invalid_response', 'The VPN service returned an invalid response.')
  }
  if (response.ok) return response.result
  const error = response.error
  if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') {
    throw new VpnDaemonError('invalid_response', 'The VPN service returned an invalid error.')
  }
  throw new VpnDaemonError(error.code, error.message)
}

// Only the layout is detected; the path itself is never read from the environment.
export function daemonSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SNAP_NAME === 'k1vpn' ? SNAP_SOCKET_PATH : SYSTEM_SOCKET_PATH
}

export type DaemonMethod = 'ping' | 'status' | 'connect' | 'disconnect' | 'recover' | 'verify'

export function daemonRequest(method: DaemonMethod, params: unknown = {}): Promise<unknown> {
  if (process.platform !== 'linux') return Promise.reject(new VpnDaemonError('unsupported_platform', 'The VPN service is available only on Linux.'))
  const id = nextId
  nextId = nextId >= Number.MAX_SAFE_INTEGER ? 1 : nextId + 1
  const request = `${JSON.stringify({ v: PROTOCOL_VERSION, id, method, params })}\n`
  if (Buffer.byteLength(request, 'utf8') > MAX_REQUEST_BYTES) {
    return Promise.reject(new VpnDaemonError('request_too_large', 'The VPN service request exceeded the protocol limit.'))
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: daemonSocketPath() })
    let settled = false
    let response = ''
    const finish = (error?: Error, result?: unknown): void => {
      if (settled) return
      settled = true
      socket.destroy()
      error ? reject(error) : resolve(result)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(method === 'ping' || method === 'status' ? REQUEST_TIMEOUT_MS : method === 'verify' ? VERIFY_TIMEOUT_MS : MUTATION_TIMEOUT_MS)
    socket.once('connect', () => socket.write(request))
    socket.on('data', (chunk: string) => {
      response += chunk
      if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES) return finish(new VpnDaemonError('response_too_large', 'The VPN service response exceeded the protocol limit.'))
      const newline = response.indexOf('\n')
      if (newline < 0) return
      try { finish(undefined, parseDaemonResponse(response.slice(0, newline), id)) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
    socket.once('timeout', () => finish(new VpnDaemonError('timeout', 'The VPN service did not respond in time.')))
    socket.once('error', () => finish(new VpnDaemonError('unavailable', 'The Linux networking service is unavailable.')))
    socket.once('end', () => { if (!settled) finish(new VpnDaemonError('invalid_response', 'The VPN service closed the connection without a response.')) })
  })
}
