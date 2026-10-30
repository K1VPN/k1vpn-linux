import { describe, expect, it } from 'vitest'
import { computeVirtualRange, virtualListHeight } from './virtualRange'

describe('computeVirtualRange', () => {
  it('returns an empty range for an empty list', () => {
    expect(computeVirtualRange(0, 600, 0, 74, 6)).toEqual({ start: 0, end: 0 })
  })

  it('renders the whole list when it fits inside the viewport plus overscan', () => {
    expect(computeVirtualRange(0, 600, 5, 74, 6, 6)).toEqual({ start: 0, end: 5 })
  })

  it('starts at the top (never negative) when scrolled to the top, minus overscan', () => {
    const range = computeVirtualRange(0, 400, 200, 74, 6, 4)
    expect(range.start).toBe(0)
  })

  it('advances the start as scrollTop increases, offset by overscan', () => {
    const stride = 74 + 6
    // Scrolled exactly 10 rows down.
    const range = computeVirtualRange(10 * stride, 400, 200, 74, 6, 4)
    expect(range.start).toBe(10 - 4)
  })

  it('never renders past the end of the list, even deep overscan near the bottom', () => {
    const stride = 80
    const range = computeVirtualRange(195 * stride, 400, 200, 74, 6, 50)
    expect(range.end).toBe(200)
    expect(range.start).toBeLessThan(200)
  })

  it('covers the full visible viewport height, not just one row', () => {
    // 400px viewport / 80px stride = 5 rows minimum, plus overscan on both sides.
    const range = computeVirtualRange(0, 400, 200, 74, 6, 2)
    expect(range.end - range.start).toBeGreaterThanOrEqual(5 + 2)
  })

  // Elastic overscroll can briefly put `scrollTop` outside the real scrollable range during a
  // fast fling. The server list must never render no rows while the value settles.
  it('never returns an empty (start > end) range when scrollTop overshoots past the bottom', () => {
    const stride = 80
    // scrollTop far beyond (rowCount * stride): the kind of value a fast rubber-band fling
    // can momentarily report, well past where the list's content actually ends.
    const range = computeVirtualRange(10_000 * stride, 400, 200, 74, 6, 4)
    expect(range.start).toBeLessThan(range.end)
    expect(range.end).toBe(200)
  })

  it('never returns a negative-feeling range when scrollTop overshoots before the top', () => {
    const range = computeVirtualRange(-5000, 400, 200, 74, 6, 4)
    expect(range.start).toBe(0)
    expect(range.start).toBeLessThan(range.end)
  })

  it('still renders every row when the whole (short) list fits, however far scrollTop overshoots', () => {
    const range = computeVirtualRange(999_999, 400, 5, 74, 6, 4)
    expect(range).toEqual({ start: 0, end: 5 })
  })
})

describe('fixed-height virtual canvas', () => {
  it('matches the full list geometry with a single gap between adjacent rows', () => {
    expect(virtualListHeight(0, 57, 6)).toBe(0)
    expect(virtualListHeight(1, 57, 6)).toBe(57)
    expect(virtualListHeight(200, 57, 6)).toBe(200 * 57 + 199 * 6)
  })

  it('covers the actual viewport through rapid direction changes and elastic overscroll', () => {
    const count = 200
    const height = 57
    const gap = 6
    const viewport = 400
    const fullHeight = virtualListHeight(count, height, gap)
    const positions = [0, 8000, 12000, 3500, -500, 14000, 1200, 0, 6000, 12500]
    for (const scrollTop of positions) {
      const range = computeVirtualRange(scrollTop, viewport, count, height, gap)
      const viewportTop = Math.max(0, Math.min(scrollTop, fullHeight - viewport))
      const firstRowTop = range.start * (height + gap)
      const lastRowBottom = (range.end - 1) * (height + gap) + height
      expect(firstRowTop).toBeLessThanOrEqual(viewportTop)
      expect(lastRowBottom).toBeGreaterThanOrEqual(viewportTop + viewport)
      expect(lastRowBottom).toBeLessThanOrEqual(fullHeight)
    }
  })
})
