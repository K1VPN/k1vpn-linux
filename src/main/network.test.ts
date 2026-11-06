import { describe, expect, it } from 'vitest'
import { parseDefaultRoutes, readingFrom } from './network'

const address = (family: 'IPv4' | 'IPv6', value: string, internal = false) =>
  ({ family, address: value, cidr: family === 'IPv4' ? `${value}/24` : `${value}/64`, internal }) as never

const TABLE = [
  'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask',
  'eth0\t00000000\t0102000A\t0003\t0\t0\t100\t00000000',
  'k1vpn0\t00000000\t00000000\t0001\t0\t0\t0\t00000000',
  'eth0\t0002000A\t00000000\t0001\t0\t0\t100\t00FFFFFF'
].join('\n')

describe('uplink reading', () => {
  it('reads only physical default routes', () => {
    expect(parseDefaultRoutes(TABLE)).toEqual(['eth0>0102000A'])
  })

  it('is up with a physical IPv4 address and ignores the tunnel and bridges', () => {
    const reading = readingFrom(
      {
        lo: [address('IPv4', '127.0.0.1', true)],
        eth0: [address('IPv4', '192.0.2.5')],
        k1vpn0: [address('IPv4', '10.8.0.2')],
        docker0: [address('IPv4', '172.17.0.1')]
      },
      TABLE
    )
    expect(reading.state).toBe('up')
    expect(reading.key).toContain('eth0=192.0.2.5/24')
    expect(reading.key).not.toContain('10.8.0.2')
    expect(reading.key).not.toContain('172.17.0.1')
  })

  it('is down with only loopback, link-local and tunnel interfaces', () => {
    expect(
      readingFrom(
        {
          lo: [address('IPv4', '127.0.0.1', true)],
          wlan0: [address('IPv6', 'fe80::1'), address('IPv4', '169.254.3.4')],
          k1vpn0: [address('IPv4', '10.8.0.2')]
        },
        null
      )
    ).toEqual({ state: 'down', key: '' })
  })

  it('keeps the key stable when IPv6 temporary addresses rotate', () => {
    const first = readingFrom({ eth0: [address('IPv4', '192.0.2.5'), address('IPv6', '2001:db8::a')] }, TABLE)
    const second = readingFrom({ eth0: [address('IPv4', '192.0.2.5'), address('IPv6', '2001:db8::b')] }, TABLE)
    expect(first.key).toBe(second.key)
  })

  it('changes the key on a new gateway', () => {
    const moved = TABLE.replace('0102000A', '0101A8C0')
    const interfaces = { eth0: [address('IPv4', '192.0.2.5')] }
    expect(readingFrom(interfaces, TABLE).key).not.toBe(readingFrom(interfaces, moved).key)
  })
})
