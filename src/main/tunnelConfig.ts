import { isIP } from 'node:net'
import type { WireguardPeerConfig } from './apiClient'

export interface AccountSecrets {
  wgIp: string | null
  wgPrivateKey: string | null
  wgPublicKey: string | null
}

export interface ValidatedTunnelConfig {
  privateKey: string
  address: string
  addressFamily: 4 | 6
  peerPublicKey: string
  endpointHost: string
  endpointPort: number
  allowedIps: string[]
  dns: string[]
  persistentKeepalive: number | null
  blockIpv4: boolean
  blockIpv6: boolean
}

export class TunnelConfigError extends Error {
  constructor(readonly code: 'MISSING_IDENTITY' | 'INVALID_PRIVATE_KEY' | 'INVALID_PEER_KEY' | 'INVALID_ADDRESS' | 'INVALID_ENDPOINT' | 'INVALID_ALLOWED_IP' | 'NO_FULL_TUNNEL' | 'INVALID_DNS' | 'NO_USABLE_DNS' | 'INVALID_KEEPALIVE') {
    super('The VPN configuration for this server is invalid.')
    this.name = 'TunnelConfigError'
  }
}

function fail(code: TunnelConfigError['code']): never { throw new TunnelConfigError(code) }

export function isWireguardKey(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}

function ipv4Bytes(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    out.push(octet)
  }
  return out
}

function ipv6Bytes(input: string): number[] | null {
  if (!input || input.includes('%') || input.includes('[') || input.includes(']')) return null
  let value = input
  if (value.includes('.')) {
    const colon = value.lastIndexOf(':')
    if (colon < 0) return null
    const v4 = ipv4Bytes(value.slice(colon + 1))
    if (!v4) return null
    value = `${value.slice(0, colon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (!part) return []
    const groups: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      groups.push(Number.parseInt(group, 16))
    }
    return groups
  }
  const left = parse(halves[0])
  const right = parse(halves[1] ?? '')
  if (!left || !right) return null
  let groups: number[]
  if (halves.length === 1) {
    if (left.length !== 8) return null
    groups = left
  } else {
    if (left.length + right.length >= 8) return null
    groups = [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right]
  }
  return groups.flatMap((group) => [group >> 8, group & 0xff])
}

function addressBytes(value: string): { family: 4 | 6; bytes: number[] } | null {
  const v4 = ipv4Bytes(value)
  if (v4) return { family: 4, bytes: v4 }
  const v6 = ipv6Bytes(value)
  return v6 ? { family: 6, bytes: v6 } : null
}

interface Cidr { original: string; family: 4 | 6; bytes: number[]; prefix: number }

function parseCidr(value: string): Cidr | null {
  const parts = value.split('/')
  if (parts.length !== 2 || !/^(0|[1-9]\d{0,2})$/.test(parts[1])) return null
  const address = addressBytes(parts[0])
  if (!address) return null
  const prefix = Number(parts[1])
  if (prefix > (address.family === 4 ? 32 : 128)) return null
  return { original: value, ...address, prefix }
}

function contains(route: Cidr, address: { family: 4 | 6; bytes: number[] }): boolean {
  if (route.family !== address.family) return false
  const fullBytes = Math.floor(route.prefix / 8)
  for (let index = 0; index < fullBytes; index += 1) if (route.bytes[index] !== address.bytes[index]) return false
  const remainder = route.prefix % 8
  if (remainder === 0) return true
  const mask = (0xff << (8 - remainder)) & 0xff
  return (route.bytes[fullBytes] & mask) === (address.bytes[fullBytes] & mask)
}

function parseEndpoint(value: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)]:(\d{1,5})$/.exec(value)
  if (bracketed) {
    const port = Number(bracketed[2])
    if (isIP(bracketed[1]) !== 6 || port < 1 || port > 65_535) fail('INVALID_ENDPOINT')
    return { host: bracketed[1], port }
  }
  const colon = value.lastIndexOf(':')
  if (colon <= 0) fail('INVALID_ENDPOINT')
  const host = value.slice(0, colon)
  const portText = value.slice(colon + 1)
  if (!/^\d{1,5}$/.test(portText)) fail('INVALID_ENDPOINT')
  const port = Number(portText)
  const hostname = /^(?=.{1,253}$)[0-9A-Za-z](?:[0-9A-Za-z-]{0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:[0-9A-Za-z-]{0,61}[0-9A-Za-z])?)*$/
  if (port < 1 || port > 65_535 || (isIP(host) !== 4 && !hostname.test(host))) fail('INVALID_ENDPOINT')
  return { host, port }
}

function usableDns(address: { family: 4 | 6; bytes: number[] }): boolean {
  const bytes = address.bytes
  if (address.family === 4) {
    return !(bytes[0] === 0 || bytes[0] === 127 || bytes[0] >= 224 || (bytes[0] === 169 && bytes[1] === 254) || bytes.every((value) => value === 255))
  }
  const allZero = bytes.every((value) => value === 0)
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1
  const multicast = bytes[0] === 0xff
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80
  const v4Mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  return !(allZero || loopback || multicast || linkLocal || v4Mapped)
}

export function validateTunnelConfig(secrets: AccountSecrets, peer: WireguardPeerConfig, dnsEntries: readonly string[]): ValidatedTunnelConfig {
  if (!secrets.wgIp || !secrets.wgPrivateKey) fail('MISSING_IDENTITY')
  if (!isWireguardKey(secrets.wgPrivateKey)) fail('INVALID_PRIVATE_KEY')
  if (!isWireguardKey(peer.serverPublicKey)) fail('INVALID_PEER_KEY')
  const ownAddress = addressBytes(secrets.wgIp)
  if (!ownAddress) fail('INVALID_ADDRESS')
  const endpoint = parseEndpoint(peer.endpoint)
  if (peer.allowedIps.length === 0) fail('INVALID_ALLOWED_IP')
  const routes = peer.allowedIps.map((value) => parseCidr(value) ?? fail('INVALID_ALLOWED_IP'))
  const sameFamily = routes.filter((route) => route.family === ownAddress.family)
  if (!sameFamily.some((route) => route.prefix === 0)) fail('NO_FULL_TUNNEL')
  if (peer.persistentKeepalive !== null && (!Number.isInteger(peer.persistentKeepalive) || peer.persistentKeepalive < 0 || peer.persistentKeepalive > 65_535)) fail('INVALID_KEEPALIVE')

  const dns: string[] = []
  for (const raw of dnsEntries) {
    const value = raw.trim()
    if (!value) continue
    const address = addressBytes(value)
    if (!address || !usableDns(address)) fail('INVALID_DNS')
    if (sameFamily.some((route) => contains(route, address)) && !dns.includes(value)) dns.push(value)
  }
  if (dns.length === 0) fail('NO_USABLE_DNS')

  return {
    privateKey: secrets.wgPrivateKey,
    address: secrets.wgIp,
    addressFamily: ownAddress.family,
    peerPublicKey: peer.serverPublicKey,
    endpointHost: endpoint.host,
    endpointPort: endpoint.port,
    allowedIps: sameFamily.map((route) => route.original),
    dns,
    persistentKeepalive: peer.persistentKeepalive,
    // K1VPN is full-tunnel-only. The family with no assigned interface
    // address is explicitly blocked even if the backend omitted its /0.
    blockIpv4: ownAddress.family !== 4,
    blockIpv6: ownAddress.family !== 6
  }
}
