import { useEffect, useState } from 'react'

/**
 * True once `active` has stayed true for `ms` without interruption; false again as soon as it
 * turns false. Used to hold back a softer status (e.g. "VPN connected" while the address is still
 * being confirmed) so a connection that confirms normally never flashes it.
 */
export function useAfterDelay(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setElapsed(true), ms)
    // Ending this waiting spell (active turned false, or ms changed) starts the next one afresh.
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active, ms])
  return active && elapsed
}
