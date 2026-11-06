import { describe, expect, it } from 'vitest'
import { requestRetryDelay } from './requestBackoff'

describe('automatic request retry budgets', () => {
  it('spreads retries even after reaching the maximum delay', () => {
    expect(requestRetryDelay(30, 1000, 120_000, () => 0)).toBe(96_000)
    expect(requestRetryDelay(30, 1000, 120_000, () => 1)).toBe(120_000)
  })

  it('bounds a ten-minute outage instead of continuing one-second retries', () => {
    let elapsed = 0
    let requests = 1
    while (true) {
      elapsed += requestRetryDelay(requests - 1, 1000, 120_000, () => 0)
      if (elapsed > 600_000) break
      requests++
    }
    expect(requests).toBeLessThanOrEqual(13)
  })
})
