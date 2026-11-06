/** Spread automatic retries between clients without retrying earlier than the chosen floor. */
export function jitteredDelay(milliseconds: number, random: () => number = Math.random): number {
  return Math.round(milliseconds * (1 + Math.max(0, Math.min(1, random())) * 0.25))
}

/** Bounded exponential retry delay; the random spread remains present at the cap. */
export function requestRetryDelay(
  attempt: number,
  base = 1000,
  maximum = 120_000,
  random: () => number = Math.random
): number {
  return jitteredDelay(Math.min(maximum / 1.25, base * 2 ** Math.min(attempt, 20)), random)
}
