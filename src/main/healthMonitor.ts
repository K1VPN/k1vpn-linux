/**
 * The main-process owner of the connection state: the one place that asks the service for
 * status, the one place that looks up the public address, and the one source the window reads
 * (over IPC). It runs whether or not a window exists.
 *
 * Shape: one loop, one timer, one status request in flight. Network changes wake the loop at
 * once; the timer is only the bounded fallback. The rules about what proves what live in
 * shared/connectionHealth.ts; this file only performs the I/O and keeps it honest:
 *
 * - every request carries the epoch it started in; an answer from an older epoch is dropped, so
 *   a reply that was in flight when the network changed can never restore "Protected";
 * - a change of epoch aborts the running lookup and reads the status again immediately;
 * - the address lookup is throttled with a growing back-off; only the service's own liveness
 *   check (`verify`) can mark a stale connection unverified or lost, never the address lookup;
 * - none of either happens in a steady, verified state;
 * - a snapshot is published only when something a user can see changed.
 */
import {
  evidenceFresh,
  initialHealthState,
  parseStatusReading,
  reduceHealth,
  sameHealth,
  snapshotOf,
  verificationDue,
  type EpochReason,
  type HealthEvent,
  type HealthSnapshot,
  type HealthState,
  type OperationKind,
  type PublicIp,
  type StatusReading
} from '../shared/connectionHealth'
import { jitteredDelay } from '../shared/requestBackoff'
import type { UplinkSource } from './network'

export interface HealthDeps {
  /** The service's raw status reply; rejects if it cannot be read. */
  status(): Promise<unknown>
  /** Looks up the public address through the current route, for display only. A failed lookup
   * never marks the connection unverified or lost. */
  probe(signal: AbortSignal): Promise<PublicIp>
  /**
   * The service's own best-effort liveness check of the current tunnel. `'inconclusive'` means a
   * real check found no new evidence (never proof of loss); `'error'` means the check itself
   * could not be made and must never be treated as network evidence either way. Always resolves.
   */
  verify(): Promise<'verified' | 'inconclusive' | 'error'>
  uplink: UplinkSource
  /** Age after which communication is checked actively (tests and measurements vary it). */
  commStaleMs?: number
  now?: () => number
  random?: () => number
  /** Whether a window is showing (the address is only looked up for display when it is). */
  windowVisible?: boolean
  /** Whether the address may be looked up while disconnected. Off until the user accepted the
   * VPN notice or a saved account was restored, so a first launch sends nothing before then. */
  addressLookupAllowed?: boolean
}

/** Steady polling of the service: the fallback, since it cannot push. */
export const POLL_MS = {
  verified: 5000,
  verifying: 1000,
  verifyingLate: 3000,
  disconnected: 10_000,
  unresolved: 3000,
  transition: 2000
}
/** After a change, poll the service this quickly for this long. */
export const FAST_WINDOW_MS = 30_000
/** Debounce of network change notifications: they come in bursts. */
export const NETWORK_EVENT_DEBOUNCE_MS = 250
/** Delay before the n-th lookup attempt in one epoch; the last value repeats while proof is missing. */
export const PROBE_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 15_000, 30_000, 60_000, 96_000]
/** Lookups while disconnected stop after this many; while connected they continue until confirmed. */
export const MAX_ADDRESS_ATTEMPTS = 5
/**
 * Delay before the n-th verification attempt in one stale spell; the last value repeats. The
 * floor is required: a verify() that settles synchronously would otherwise be asked again on the
 * very same turn, forever.
 */
export const VERIFY_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 15_000, 15_000]
/** A disconnected address older than this is refreshed when the window shows. */
export const DISCONNECTED_IP_TTL_MS = 5 * 60_000

type Listener = (snapshot: HealthSnapshot) => void

/** The server the service says it is connected to, if its reply carries one. */
function serverIdOf(raw: unknown): string | null {
  const value = (raw as { server_id?: unknown } | null)?.server_id
  return typeof value === 'string' ? value : null
}

export class HealthMonitor {
  private state: HealthState
  private snapshot: HealthSnapshot
  private revision = 0
  private readonly listeners = new Set<Listener>()
  private readonly now: () => number
  private windowVisible: boolean
  private addressLookupAllowed: boolean
  private stopped = true
  private looping?: Promise<void>
  private again = false
  private timer?: ReturnType<typeof setTimeout>
  private eventTimer?: ReturnType<typeof setTimeout>
  private unwatch?: () => void
  private probe?: { controller: AbortController; epoch: number }
  private probeAttempts = 0
  private probeNotBefore = 0
  /** The epoch of the one `deps.verify()` call in flight, if any. */
  private verifying?: number
  private verifyAttempts = 0
  private verifyNotBefore = 0

  constructor(private readonly deps: HealthDeps) {
    this.now = deps.now ?? Date.now
    this.windowVisible = deps.windowVisible ?? false
    this.addressLookupAllowed = deps.addressLookupAllowed ?? true
    this.state = initialHealthState(this.now(), { commStaleMs: deps.commStaleMs })
    this.snapshot = snapshotOf(this.state, this.revision)
  }

  /** The latest snapshot (contains no secrets; safe to hand to a renderer). */
  get(): HealthSnapshot {
    return this.snapshot
  }

  /** Calls `listener` with every later snapshot. Nothing is replayed: pair it with {@link get}. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.unwatch = this.deps.uplink.watch(() => this.onNetworkEvent())
    this.checkUplink()
    this.kick()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    clearTimeout(this.eventTimer)
    this.eventTimer = undefined
    this.probe?.controller.abort()
    this.probe = undefined
    this.unwatch?.()
    this.unwatch = undefined
    this.listeners.clear()
  }

  /** Reads the status now (e.g. after the user acted on the recovery screen). */
  refresh(): Promise<void> {
    this.kick()
    return this.looping ?? Promise.resolve()
  }

  /** Account change, suspend, resume, service restart: nothing proven before it counts. */
  invalidate(reason: EpochReason): void {
    this.apply({ type: 'epoch', now: this.now(), reason })
    if (reason === 'resume') this.checkUplink()
  }

  setWindowVisible(visible: boolean): void {
    if (this.windowVisible === visible) return
    this.windowVisible = visible
    // Showing a window that already has a current address needs no request at all.
    if (visible && this.addressWanted()) this.kick()
  }

  /** Looking up the address while disconnected is now fine; stays allowed for the process. */
  allowAddressLookup(): void {
    if (this.addressLookupAllowed) return
    this.addressLookupAllowed = true
    if (this.addressWanted()) this.kick()
  }

  /**
   * Runs a user-visible operation (connect, disconnect, quit): the display follows it, polling
   * pauses, anything in flight before it is discarded, and the truth is read again afterwards.
   * Only one at a time.
   */
  async operation<T>(
    kind: OperationKind,
    action: () => Promise<T>,
    serverId?: string | null
  ): Promise<T> {
    if (this.state.operation) throw new Error('K1VPN is busy. Please wait.')
    this.apply({ type: 'operation', now: this.now(), operation: kind, serverId })
    try {
      return await action()
    } finally {
      // The tunnel just changed the routes: look at the network before the operation ends, so
      // that this is one epoch and not two.
      this.checkUplink()
      // Ending the operation is a new epoch, which reads the truth straight away.
      this.apply({ type: 'operation', now: this.now(), operation: null })
    }
  }

  // --- internals ---------------------------------------------------------------------------

  private apply(event: HealthEvent): void {
    const before = this.state
    this.state = reduceHealth(before, event)
    if ((before.verifyFrom === null) !== (this.state.verifyFrom === null)) {
      // A check began, or communication resumed: both start again from the first attempt.
      this.probeAttempts = 0
      this.probeNotBefore = 0
      this.verifyAttempts = 0
      this.verifyNotBefore = 0
    }
    if (this.state.epoch !== before.epoch) {
      // What was in flight belongs to a moment nobody trusts any more.
      this.probe?.controller.abort()
      this.probe = undefined
      this.probeAttempts = 0
      this.probeNotBefore = 0
      this.verifyAttempts = 0
      this.verifyNotBefore = 0
      // A status that itself revealed the change is the new epoch's first reading already.
      if (!this.stopped && event.type !== 'status') this.kick()
    }
    const next = snapshotOf(this.state, this.revision)
    if (!sameHealth(next, this.snapshot)) {
      this.snapshot = { ...next, revision: ++this.revision }
      for (const listener of [...this.listeners]) {
        try {
          listener(this.snapshot)
        } catch {
          /* A failing listener must not stop the others or the loop. */
        }
      }
    }
  }

  private onNetworkEvent(): void {
    if (this.stopped || this.eventTimer) return
    // Leading throttle: the first event of a burst schedules one read; the rest fold into it.
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined
      this.checkUplink()
    }, NETWORK_EVENT_DEBOUNCE_MS)
  }

  private checkUplink(): void {
    if (this.stopped) return
    const reading = this.deps.uplink.read()
    this.apply({ type: 'uplink', now: this.now(), state: reading.state, key: reading.key })
  }

  private kick(): void {
    if (this.stopped) return
    if (this.looping) {
      this.again = true
      return
    }
    const loop = this.loop().finally(() => {
      if (this.looping === loop) this.looping = undefined
      this.scheduleNext()
    })
    this.looping = loop
  }

  private async loop(): Promise<void> {
    do {
      this.again = false
      clearTimeout(this.timer)
      await this.cycle()
    } while (this.again && !this.stopped)
  }

  private async cycle(): Promise<void> {
    if (this.state.operation !== null) return
    const epoch = this.state.epoch
    let reading: StatusReading | null = null
    try {
      const raw = await this.deps.status()
      reading = parseStatusReading(raw, serverIdOf(raw))
    } catch {
      reading = null
    }
    if (this.stopped) return
    this.apply({ type: 'status', now: this.now(), epoch, reading })
    // Belt and braces for a missed change notification, at the poll rate.
    this.checkUplink()
    this.maybeVerify()
    this.maybeProbe()
  }

  private addressWanted(): boolean {
    const s = this.state
    if (s.uplink === 'down' || s.operation !== null) return false
    if (s.tunnel === 'connected') {
      // Once confirmed for this epoch, the address is not re-fetched merely because proof has
      // gone stale: that is what `deps.verify()` is for.
      return s.ip.state !== 'ready'
    }
    if (s.tunnel === 'disconnected' && this.windowVisible && this.addressLookupAllowed) {
      if (s.ip.state === 'ready') return this.now() - s.ip.at > DISCONNECTED_IP_TTL_MS
      return this.probeAttempts < MAX_ADDRESS_ATTEMPTS
    }
    return false
  }

  private maybeProbe(): void {
    if (this.stopped || this.probe || !this.addressWanted()) return
    if (this.probeNotBefore - this.now() > 0) return
    const controller = new AbortController()
    const epoch = this.state.epoch
    this.probe = { controller, epoch }
    const attempt = this.probeAttempts++
    this.probeNotBefore =
      this.now() +
      jitteredDelay(
        PROBE_BACKOFF_MS[Math.min(attempt + 1, PROBE_BACKOFF_MS.length - 1)],
        this.deps.random
      )
    this.deps.probe(controller.signal).then(
      (ip) => this.finishProbe(controller, epoch, { ok: true, ip }),
      () => this.finishProbe(controller, epoch, { ok: false })
    )
  }

  private finishProbe(
    controller: AbortController,
    epoch: number,
    result: { ok: true; ip: PublicIp } | { ok: false }
  ): void {
    if (this.probe?.controller === controller) this.probe = undefined
    if (this.stopped || controller.signal.aborted) return
    this.apply({ type: 'probe', now: this.now(), epoch, result })
    // The probe generated traffic: read the counters now, not at the next tick.
    this.kick()
  }

  /** Fires the service's own check when communication has gone stale, one at a time, with a
   * growing floor between attempts. */
  private maybeVerify(): void {
    if (this.stopped || this.verifying !== undefined || !verificationDue(this.state)) return
    if (this.verifyNotBefore - this.now() > 0) return
    const epoch = this.state.epoch
    this.verifying = epoch
    const attempt = this.verifyAttempts++
    this.verifyNotBefore =
      this.now() + VERIFY_BACKOFF_MS[Math.min(attempt + 1, VERIFY_BACKOFF_MS.length - 1)]
    this.deps.verify().then(
      (result) => this.finishVerify(epoch, result),
      () => this.finishVerify(epoch, 'error')
    )
  }

  private finishVerify(epoch: number, result: 'verified' | 'inconclusive' | 'error'): void {
    if (this.verifying === epoch) this.verifying = undefined
    if (this.stopped) return
    this.apply({ type: 'verify', now: this.now(), epoch, result })
    // Settling it may have changed what should happen next (retry, or stop).
    this.kick()
  }

  private nextDelay(): number | null {
    const s = this.state
    if (this.stopped || s.operation !== null) return null
    if (!s.ready || s.tunnel === 'unknown' || s.recoveryRequired) return POLL_MS.unresolved
    switch (s.tunnel) {
      case 'disconnected':
        return POLL_MS.disconnected
      case 'connecting':
      case 'disconnecting':
        return POLL_MS.transition
      case 'connected': {
        if (evidenceFresh(s) && !verificationDue(s)) return POLL_MS.verified
        if (verificationDue(s)) return POLL_MS.verifying
        return this.now() - s.epochAt < FAST_WINDOW_MS ? POLL_MS.verifying : POLL_MS.verifyingLate
      }
    }
  }

  private scheduleNext(): void {
    clearTimeout(this.timer)
    const delay = this.nextDelay()
    if (delay === null) return
    // Never sleep past a lookup or a check that is waiting for its own back-off to end.
    const probeWait = this.probeNotBefore - this.now()
    let next = this.addressWanted() && probeWait > 0 ? Math.min(delay, probeWait) : delay
    const verifyWait = this.verifyNotBefore - this.now()
    if (verificationDue(this.state) && verifyWait > 0) next = Math.min(next, verifyWait)
    this.timer = setTimeout(() => this.kick(), next)
  }
}
