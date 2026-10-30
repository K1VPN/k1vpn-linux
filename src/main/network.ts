/**
 * The physical network as the health monitor sees it. Electron's own online flag cannot say
 * whether a physical uplink exists (a virtual adapter, including the tunnel, is always "up"), so
 * the answer comes from the interface list and the main routing table, with the tunnel and
 * container bridges left out.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { readFileSync } from 'node:fs'
import type { UplinkState } from '../shared/connectionHealth'

export interface UplinkReading {
  state: UplinkState
  /**
   * Identity of the network the tunnel's packets travel over: the physical interfaces with
   * their IPv4 addresses and the default gateway. It changes on a handover or a new gateway or
   * address, and not on rotating IPv6 temporary addresses or the tunnel's own interface.
   */
  key: string
}

export interface UplinkSource {
  read(): UplinkReading
  /** Calls `onChange` when the reading's key or state changed. Returns a stopper. */
  watch(onChange: () => void): () => void
}

const NON_PHYSICAL = /^(lo|k1vpn\d*|wg\d*|tun\d*|tap\d*|docker\d*|br-|veth|virbr|vboxnet|vmnet|lxc|lxd|podman|cni|flannel|cali)/

type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>

/** Default IPv4 route(s) from the main table: `interface gateway`, tunnel excluded. */
export function parseDefaultRoutes(table: string): string[] {
  const routes: string[] = []
  for (const line of table.split('\n').slice(1)) {
    const [name, destination, gateway, flags] = line.trim().split(/\s+/)
    if (!name || destination !== '00000000' || NON_PHYSICAL.test(name)) continue
    if (!flags || (Number.parseInt(flags, 16) & 0x1) === 0) continue
    routes.push(`${name}>${gateway}`)
  }
  return routes.sort()
}

export function readingFrom(interfaces: Interfaces, routeTable: string | null): UplinkReading {
  const parts: string[] = []
  let globalIpv6 = false
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (NON_PHYSICAL.test(name)) continue
    for (const info of addresses ?? []) {
      if (info.internal) continue
      if (info.family === 'IPv4') {
        if (!info.address.startsWith('169.254.')) parts.push(`${name}=${info.cidr ?? info.address}`)
      } else if (!info.address.toLowerCase().startsWith('fe80:')) {
        globalIpv6 = true
      }
    }
  }
  if (parts.length === 0 && !globalIpv6) return { state: 'down', key: '' }
  if (globalIpv6) parts.push('v6')
  if (routeTable !== null) parts.push(...parseDefaultRoutes(routeTable))
  return { state: 'up', key: parts.sort().join('|') }
}

function readRouteTable(): string | null {
  try {
    return readFileSync('/proc/net/route', 'utf8')
  } catch {
    return null
  }
}

export function createUplinkSource(pollMs = 2_000): UplinkSource {
  const read = (): UplinkReading => {
    try {
      return readingFrom(networkInterfaces(), readRouteTable())
    } catch {
      return { state: 'unknown', key: '' }
    }
  }
  return {
    read,
    watch: (onChange) => {
      let last = read()
      const timer = setInterval(() => {
        const next = read()
        if (next.state === last.state && next.key === last.key) return
        last = next
        onChange()
      }, pollMs)
      timer.unref()
      return () => clearInterval(timer)
    }
  }
}
