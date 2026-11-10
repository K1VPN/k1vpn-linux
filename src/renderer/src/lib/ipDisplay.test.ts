import { describe, expect, it } from 'vitest'
import { ipLookupFailed } from './ipDisplay'

describe('IP lookup status', () => {
  it('shows lookup failure even when the VPN itself is protected or verifying', () => {
    expect(ipLookupFailed('protected', 'unavailable')).toBe(true)
    expect(ipLookupFailed('verifying', 'unavailable')).toBe(true)
  })
  it('shows checking only while the lookup has not failed', () => {
    expect(ipLookupFailed('protected', 'checking')).toBe(false)
    expect(ipLookupFailed('disconnected', 'checking')).toBe(false)
  })
})
