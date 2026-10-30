/** Extra mounted rows keep momentum scrolling covered between React commits. */
export const DEFAULT_OVERSCAN = 40

export interface VirtualRange {
  start: number
  end: number
}

/** Fixed-height virtual lists require the rendered row height to match the stride
 * exactly. The canvas keeps the full list height independently of the mounted slice. */
export function virtualListHeight(rowCount: number, rowHeight: number, rowGap: number): number {
  return rowCount > 0 ? rowCount * (rowHeight + rowGap) - rowGap : 0
}

/** The mounted slice covering the viewport plus an overscan buffer. */
export function computeVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  rowGap: number,
  overscan: number = DEFAULT_OVERSCAN
): VirtualRange {
  if (rowCount <= 0) return { start: 0, end: 0 }
  const stride = rowHeight + rowGap
  const visibleRows = Math.ceil(viewportHeight / stride) + overscan * 2
  // Elastic overscroll can let `scrollTop` run past either end
  // of the real scrollable range during a fast fling — not just negative at the top, but also
  // past `scrollHeight - clientHeight` at the bottom. Clamping `start` to `maxStart` keeps the
  // window inside the list even then; without it, a momentarily out-of-range `scrollTop` could
  // produce `start > rowCount`, and `array.slice(start, end)` with `start > end` silently
  // returns an empty list — this is what "the server list goes blank mid-fling" actually was.
  const maxStart = Math.max(0, rowCount - visibleRows)
  const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / stride) - overscan))
  const end = Math.min(rowCount, start + visibleRows)
  return { start, end }
}
