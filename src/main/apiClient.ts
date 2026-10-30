const API_BASE_URL = 'https://api.k1vpn.net'
const ACCOUNT_PATH = '/desktop/v1/account'
const SERVERS_PATH = '/desktop/v1/servers'
const WIREGUARD_PATH = '/desktop/v1/wireguard-config'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 64 * 1024
const SERVERS_MAX_RESPONSE_BYTES = 512 * 1024

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('Cannot reach K1VPN servers. Check your internet connection.')
    this.name = 'ApiUnreachableError'
    this.cause = cause
  }
}

export class ApiProtocolError extends Error {
  constructor(detail: string) {
    super('K1VPN server returned an unexpected response.')
    this.name = 'ApiProtocolError'
    this.cause = detail
  }
}

export interface VpnAccount {
  id: number
  username: string
  status: string
  wgIp: string | null
  wgPrivateKey: string | null
  wgPublicKey: string | null
  expiredAt: string | null
  created: string
  updated: string
}

export interface DesktopServer {
  id: string
  countryCode: string
  countryName: string
  city: string | null
  label: string | null
  isRecommended: boolean
  isFeatured: boolean
  loadPercent: number | null
}

export interface WireguardPeerConfig {
  serverPublicKey: string
  endpoint: string
  allowedIps: string[]
  persistentKeepalive: number | null
  dns: string[] | null
}

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0)
}

function validateCredentialInput(username: string, password: string): void {
  if (!boundedString(username, 256) || username.trim() !== username || /[\0\r\n]/.test(username)) throw new TypeError('Invalid username')
  if (!boundedString(password, 4_096) || password.includes('\0')) throw new TypeError('Invalid password')
}

function validateServerId(serverId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(serverId)) throw new TypeError('Invalid server ID')
}

const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function isValidIsoDateTime(value: string): boolean {
  const match = ISO_DATETIME_RE.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const monthDays = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]
  if (month < 1 || month > 12 || day < 1 || day > monthDays || hour > 23 || minute > 59 || second > 59) return false
  const offset = match[7]
  if (offset !== 'Z') {
    const parsed = /^[+-](\d{2}):(\d{2})$/.exec(offset)
    if (!parsed || Number(parsed[1]) > 23 || Number(parsed[2]) > 59) return false
  }
  return true
}

async function readBodyWithLimit(response: Response, maxBytes: number, path: string): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ApiProtocolError(`POST ${path}: response too large`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

async function post(path: string, payload: unknown, maxBytes: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      })
    } catch (error) {
      throw new ApiUnreachableError(error)
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new ApiProtocolError(`POST ${path}: unexpected redirect`)
    }
    let text: string
    try {
      text = await readBodyWithLimit(response, maxBytes, path)
    } catch (error) {
      if (error instanceof ApiProtocolError) throw error
      throw new ApiUnreachableError(error)
    }
    let body: unknown = null
    if (text) {
      try { body = JSON.parse(text) } catch { body = null }
    }
    if (!response.ok) {
      const safeBackendMessage = body && typeof body === 'object' && boundedString((body as Record<string, unknown>).error, 1_024)
        ? (body as { error: string }).error
        : `K1VPN server returned an unexpected error (${response.status}).`
      const message = [502, 503, 504].includes(response.status)
        ? 'K1VPN is temporarily unavailable. Please try again shortly.'
        : safeBackendMessage
      throw new ApiError(response.status, message)
    }
    if (body === null) throw new ApiProtocolError(`POST ${path}: invalid JSON`)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || boundedString(value, max)
}

export async function fetchAccount(username: string, password: string): Promise<VpnAccount> {
  validateCredentialInput(username, password)
  const body = await post(ACCOUNT_PATH, { username, password }, MAX_RESPONSE_BYTES)
  const account = body && typeof body === 'object' ? (body as Record<string, unknown>).account : null
  if (!account || typeof account !== 'object') throw new ApiProtocolError('account envelope missing')
  const value = account as Record<string, unknown>
  const expiredAt = value.expired_at
  if (
    !Number.isSafeInteger(value.id) || Number(value.id) <= 0 ||
    !boundedString(value.username, 256) || !boundedString(value.status, 128) ||
    !nullableBoundedString(value.wg_ip, 128) || !nullableBoundedString(value.wg_private_key, 128) ||
    !nullableBoundedString(value.wg_public_key, 128) ||
    !(expiredAt === null || (boundedString(expiredAt, 128) && isValidIsoDateTime(expiredAt))) ||
    !boundedString(value.created, 128) || !boundedString(value.updated, 128)
  ) throw new ApiProtocolError('account shape invalid')
  return {
    id: value.id as number,
    username: value.username,
    status: value.status,
    wgIp: value.wg_ip,
    wgPrivateKey: value.wg_private_key,
    wgPublicKey: value.wg_public_key,
    expiredAt,
    created: value.created,
    updated: value.updated
  }
}

function parseServer(raw: unknown): DesktopServer {
  if (!raw || typeof raw !== 'object') throw new ApiProtocolError('server entry invalid')
  const value = raw as Record<string, unknown>
  if (
    !boundedString(value.id, 128) || !boundedString(value.country_code, 2) || !boundedString(value.country_name, 128) ||
    !nullableBoundedString(value.city, 128) || !nullableBoundedString(value.label, 128) ||
    typeof value.is_recommended !== 'boolean' || typeof value.is_featured !== 'boolean' ||
    !(value.load_percent === null || (Number.isInteger(value.load_percent) && Number(value.load_percent) >= 0 && Number(value.load_percent) <= 100))
  ) throw new ApiProtocolError('server entry shape invalid')
  return {
    id: value.id,
    countryCode: value.country_code,
    countryName: value.country_name,
    city: value.city,
    label: value.label,
    isRecommended: value.is_recommended,
    isFeatured: value.is_featured,
    loadPercent: value.load_percent as number | null
  }
}

export async function fetchServers(username: string, password: string): Promise<DesktopServer[]> {
  validateCredentialInput(username, password)
  const body = await post(SERVERS_PATH, { username, password }, SERVERS_MAX_RESPONSE_BYTES)
  const servers = body && typeof body === 'object' ? (body as Record<string, unknown>).servers : null
  if (!Array.isArray(servers) || servers.length > 5_000) throw new ApiProtocolError('servers envelope invalid')
  return servers.map(parseServer)
}

function stringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((entry) => boundedString(entry, maxLength))
}

export async function fetchWireguardConfig(username: string, password: string, serverId: string): Promise<WireguardPeerConfig> {
  validateCredentialInput(username, password)
  validateServerId(serverId)
  const body = await post(WIREGUARD_PATH, { username, password, server_id: serverId }, MAX_RESPONSE_BYTES)
  if (!body || typeof body !== 'object') throw new ApiProtocolError('wireguard response invalid')
  const value = body as Record<string, unknown>
  if (
    !boundedString(value.server_public_key, 128) || !boundedString(value.endpoint, 512) ||
    !stringArray(value.allowed_ips, 32, 128) ||
    !(value.persistent_keepalive === null || (Number.isInteger(value.persistent_keepalive) && Number(value.persistent_keepalive) >= 0 && Number(value.persistent_keepalive) <= 65_535)) ||
    !(value.dns === null || stringArray(value.dns, 8, 128))
  ) throw new ApiProtocolError('wireguard response shape invalid')
  return {
    serverPublicKey: value.server_public_key,
    endpoint: value.endpoint,
    allowedIps: value.allowed_ips,
    persistentKeepalive: value.persistent_keepalive as number | null,
    dns: value.dns
  }
}
