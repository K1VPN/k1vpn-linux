/**
 * DNS provider choice, shared by the main process (authoritative) and the
 * settings screen (instant feedback). The Linux daemon re-checks everything and
 * routes/firewalls DNS so that it
 * can only travel inside the tunnel, whatever is chosen here.
 */

export type DnsMode = 'default' | 'cloudflare' | 'quad9' | 'google' | 'custom'

export const DNS_MODES: readonly DnsMode[] = ['default', 'cloudflare', 'quad9', 'google', 'custom']

/**
 * IPv4 only on purpose: the tunnel interface only has an IPv4 address, so an
 * IPv6 resolver would only add timeouts before the resolver falls back.
 */
export const DNS_PRESETS: Record<'cloudflare' | 'quad9' | 'google', readonly string[]> = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  quad9: ['9.9.9.9', '149.112.112.112'],
  google: ['94.140.14.15', '94.140.15.16']
}

export const MAX_CUSTOM_DNS = 2

export interface DnsSettings {
  mode: DnsMode
  /** Only used when `mode` is `custom`. */
  custom: string[]
}

export const DEFAULT_DNS_SETTINGS: DnsSettings = { mode: 'default', custom: [] }

export function isDnsMode(value: unknown): value is DnsMode {
  return typeof value === 'string' && (DNS_MODES as readonly string[]).includes(value)
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

/** Eight 16-bit groups, or null when `text` is not a plain IPv6 literal (no zone id, no brackets, no port). */
function parseIpv6(text: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null
  let tail: number[] = []
  let body = text
  const lastColon = text.lastIndexOf(':')
  if (text.includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    body = text.slice(0, lastColon + 1) + '0:0'
  }
  const halves = body.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string): number[] | null => {
    if (s === '') return []
    const groups: number[] = []
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      groups.push(parseInt(g, 16))
    }
    return groups
  }
  const head = toGroups(halves[0])
  if (!head) return null
  let groups: number[]
  if (halves.length === 2) {
    const rest = toGroups(halves[1])
    if (!rest || head.length + rest.length > 7) return null
    groups = [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest]
  } else {
    if (head.length !== 8) return null
    groups = head
  }
  if (tail.length) groups = [...groups.slice(0, 6), ...tail]
  return groups
}

function isPrivateOrLocalV4(o: number[]): boolean {
  return (
    o[0] === 10 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
  )
}

/**
 * Validates one user-typed DNS server for `custom` mode. Returns an error
 * code or null. Only public IPv4 unicast addresses are accepted: a LAN or
 * loopback resolver (Pi-hole, router, local cache) cannot be reached from the
 * VPN server, and its traffic would have to leave the tunnel, which is exactly
 * what this app prevents.
 */
export type CustomDnsProblem = 'invalid' | 'notPublic' | 'ipv4Only'

export function customDnsProblem(entry: string): CustomDnsProblem | null {
  const v4 = parseIpv4(entry)
  if (v4) {
    const [a, b] = v4
    if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || isPrivateOrLocalV4(v4))
      return 'notPublic'
    return null
  }
  const v6 = parseIpv6(entry)
  if (!v6) return 'invalid'
  // The current WireGuard client address is IPv4-only (/32), so an IPv6 DNS
  // server cannot be reached through this tunnel. Keep the UI and IPC
  // validation aligned with the route family used by the connect flow.
  return 'ipv4Only'
}

/**
 * Cleans a custom list (trim, drop blanks and duplicates) and throws on the
 * first invalid entry. Used both when saving the setting and when reading it
 * back, so a hand-edited preferences file can never smuggle in a bad address.
 */
export function normalizeCustomDns(entries: unknown): string[] {
  if (!Array.isArray(entries)) throw new TypeError('custom DNS must be a list')
  const out: string[] = []
  for (const raw of entries) {
    if (typeof raw !== 'string') throw new TypeError('custom DNS entries must be strings')
    const entry = raw.trim()
    if (entry === '') continue
    const problem = customDnsProblem(entry)
    if (problem === 'invalid') throw new Error(`${entry} is not a valid IP address`)
    if (problem === 'ipv4Only') throw new Error(`${entry} requires an IPv4-only tunnel`)
    if (problem === 'notPublic')
      throw new Error(
        `${entry} is a local or private address and cannot be used as a VPN DNS server`
      )
    if (!out.includes(entry)) out.push(entry)
  }
  if (out.length > MAX_CUSTOM_DNS) throw new Error(`Enter at most ${MAX_CUSTOM_DNS} DNS servers`)
  return out
}

/** Validates an IPC-supplied DNS setting. */
export function validateDnsSettings(mode: unknown, custom: unknown): DnsSettings {
  if (!isDnsMode(mode)) throw new TypeError('Invalid DNS provider')
  if (mode !== 'custom') return { mode, custom: [] }
  const list = normalizeCustomDns(custom ?? [])
  if (list.length === 0) throw new Error('Enter at least one DNS server')
  return { mode, custom: list }
}

/** The DNS servers to hand to the daemon (empty means: refuse to connect). */
export function effectiveDns(
  settings: DnsSettings,
  providerDns: readonly string[] | null
): string[] {
  switch (settings.mode) {
    case 'default':
      return [...(providerDns ?? [])]
    case 'custom':
      return [...settings.custom]
    default:
      return [...DNS_PRESETS[settings.mode]]
  }
}
