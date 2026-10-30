/**
 * The connection-health model: one pure reducer that every surface (the window and any
 * notification) reads through a {@link HealthSnapshot}, so they can never disagree.
 *
 * It keeps four questions apart, because "the adapter is up" answers none of the others:
 *
 * 1. the tunnel lifecycle (daemon: disconnected / connected, or nothing answering, or the kill
 *    switch waiting for recovery) and what the user is doing (an operation in progress);
 * 2. the physical network (is there any uplink at all);
 * 3. verified communication over the VPN in the *current epoch*: new data or a new handshake
 *    seen by the daemon since the last thing that could have broken the session. A reply that
 *    started before that point is never evidence (rejected by epoch fencing);
 * 4. the public-IP lookup, which is display information and a leak check, not a health test: a
 *    provider that fails or answers nonsense makes the address unavailable, never "no internet".
 *
 * Proof does not last forever just because it once held: once real communication (new data, or a
 * new handshake) has not been seen for {@link COMM_STALE_MS}, the connection is *unverified*
 * until the daemon's own best-effort check (`wg::TunnelManager::verify`, requested through
 * `verify` events here) sees new evidence. This never depends on any third party, and it never
 * downgrades a stale-but-unconfirmed connection to a confirmed loss on its own: sending a probe
 * does not force WireGuard to hand-shake again on a session that is still valid (see `verify`'s
 * own doc comment), so the *absence* of new evidence from this check proves nothing — a healthy,
 * quiet tunnel produces exactly the same "nothing new" reply as one that has actually gone dark.
 * Without a real responding endpoint on the other end (which does not exist today — a separate,
 * undecided dependency), this check can only ever raise the evidence bar back up, never lower it.
 *
 * "Protected" needs current tunnel evidence and no observed unchanged public address.
 * An unavailable address lookup does not veto tunnel evidence. "NO INTERNET" needs a
 * strong reason: no physical uplink at all — never a stale check
 * result on its own, however many times it comes back empty. Everything else that is not proven
 * stays "verifying", never green and never called a loss.
 *
 * Time is passed in, nothing here reads a clock, so the rules are testable deterministically.
 */

/** How long real communication may go unseen before the tunnel is actively checked instead of
 * just trusted. An idle tunnel is not a lost one: the check is one small, harmless request, and
 * it keeps the state green when it succeeds. */
export const COMM_STALE_MS = 30_000
/** How long the state may stay green while that check is under way, or hasn't been made yet. */
export const VERIFY_GRACE_MS = 4_000
/** Consecutive unreadable daemon statuses before the state becomes "unknown". */
export const STATUS_FAILURES_BEFORE_UNKNOWN = 2

export type TunnelState = 'unknown' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
export type UplinkState = 'unknown' | 'up' | 'down'
export type OperationKind = 'connecting' | 'disconnecting' | 'quitting'
export type IpState = 'checking' | 'ready' | 'unavailable'

export type HealthDisplay =
  | 'checking'
  | 'unknown'
  | 'blocked'
  | 'disconnected'
  | 'connecting'
  | 'disconnecting'
  | 'verifying'
  | 'protected'
  | 'no-internet'

/** Why the display is what it is, where the words alone would mislead. */
export type HealthReason =
  | 'no-uplink'
  /** A routed connectivity check failed repeatedly with no recent receive progress. */
  | 'no-response'
  | 'ip-unavailable'
  | 'ip-unchanged'
  /** Proven once, but no recent communication could be confirmed (not a confirmed loss). */
  | 'stale'

export interface PublicIp {
  ip: string
  countryCode: string | null
  countryName: string | null
}

/** What the renderer sees. Contains no secrets. */
export interface HealthSnapshot {
  /** Increases only when something meaningful changed; a renderer drops anything not newer. */
  revision: number
  display: HealthDisplay
  reason: HealthReason | null
  network: UplinkState
  operation: OperationKind | null
  serverId: string | null
  publicIp: PublicIp | null
  ipState: IpState
  /** True while a tunnel exists (used by the UI to keep the Disconnect button available). */
  tunnelUp: boolean
}

export interface StatusReading {
  state: 'disconnected' | 'connected' | 'connecting' | 'disconnecting'
  recoveryRequired: boolean
  /** Whole seconds since the last handshake, null if there has been none. */
  handshakeAge: number | null
  /** Bytes received from the peer since the tunnel was created (newer daemons only). */
  rx: number | null
  serverId: string | null
}

export interface HealthState {
  /** Any status has been applied (a reading, or enough failures). Before this: "checking". */
  ready: boolean
  epoch: number
  epochAt: number
  tunnel: TunnelState
  recoveryRequired: boolean
  statusFailures: number
  serverId: string | null
  operation: OperationKind | null
  /** The operation that just ended, kept until the epoch it opened has its first real status
   * reading: `tunnel` is still the pre-operation value until then, so the display must keep
   * following the finished operation rather than reading that stale field (see {@link deriveDisplay}). */
  pendingConfirm: OperationKind | null
  uplink: UplinkState
  uplinkKey: string
  handshakeAge: number | null
  rx: number | null
  /** Counter value of the first reading of this epoch; only used to detect the first proof. */
  baselineRx: number | null
  /** Real communication has been seen at least once in this epoch (never reset except by a new
   * epoch — staleness is tracked separately, by {@link HealthState.unverified}). */
  evidence: boolean
  /** When the previous reading of this epoch was taken (its counters are the reference). */
  lastReadAt: number | null
  /**
   * A conservative time by which real communication was last seen in this epoch: data from the
   * peer arrived after the previous reading, a handshake completed, or the daemon's own check
   * (`verify`) last succeeded. Independent of the handshake's own age, which only says the
   * session may still be alive.
   */
  commAt: number | null
  /** When communication was last found stale and active checking began; null while current. */
  verifyFrom: number | null
  /** Consecutive checks since `verifyFrom` that came back with no new evidence (never counts an
   * `'error'` result — see {@link applyVerify} — only ever used to skip the rest of
   * {@link VERIFY_GRACE_MS} once a real check has actually come back empty). */
  verifyFailures: number
  /** Communication is stale and not yet reconfirmed by a check (not the same as a confirmed loss). */
  unverified: boolean
  /** Age after which communication counts as stale (see {@link COMM_STALE_MS}). */
  commStaleMs: number
  ip: { info: PublicIp | null; state: IpState; reason: HealthReason | null; at: number }
  /** The address seen while disconnected: an address equal to it under the tunnel is not proof. */
  preVpnIp: string | null
}

export type EpochReason = 'account' | 'suspend' | 'resume' | 'service' | 'operation'

export type HealthEvent =
  | { type: 'status'; now: number; epoch: number; reading: StatusReading | null }
  | { type: 'uplink'; now: number; state: UplinkState; key: string }
  | { type: 'epoch'; now: number; reason: EpochReason }
  | { type: 'operation'; now: number; operation: OperationKind | null; serverId?: string | null }
  | {
      type: 'probe'
      now: number
      epoch: number
      result: { ok: true; ip: PublicIp } | { ok: false }
    }
  /** The daemon's answer to its own liveness check — see `wg.rs`'s `verify` and its `VerifyOutcome`
   * for exactly what each result does and does not prove. `'verified'` is positive evidence;
   * `'inconclusive'` is a real check that found nothing new (never proof of loss — see this
   * module's own doc comment); `'error'` means the check itself could not be made (IPC/local
   * failure, no tunnel, or a tunnel generation race) and says nothing about the tunnel at all. */
  | { type: 'verify'; now: number; epoch: number; result: 'verified' | 'inconclusive' | 'error' }

export function initialHealthState(now = 0, options: { commStaleMs?: number } = {}): HealthState {
  return {
    ready: false,
    epoch: 0,
    epochAt: now,
    tunnel: 'unknown',
    recoveryRequired: false,
    statusFailures: 0,
    serverId: null,
    operation: null,
    pendingConfirm: null,
    uplink: 'unknown',
    uplinkKey: '',
    handshakeAge: null,
    rx: null,
    baselineRx: null,
    evidence: false,
    lastReadAt: null,
    commAt: null,
    verifyFrom: null,
    verifyFailures: 0,
    unverified: false,
    commStaleMs: options.commStaleMs ?? COMM_STALE_MS,
    ip: { info: null, state: 'checking', reason: null, at: 0 },
    preVpnIp: null
  }
}

/** Parses the Linux daemon's status reply; null if it is not one. */
export function parseStatusReading(value: unknown, serverId: string | null): StatusReading | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const state = data.state
  if (
    state !== 'disconnected' &&
    state !== 'connected' &&
    state !== 'connecting' &&
    state !== 'disconnecting'
  ) {
    return null
  }
  const age = data.last_handshake_secs_ago
  const rx = data.rx_bytes
  return {
    state,
    recoveryRequired: data.recovery_required === true,
    handshakeAge: typeof age === 'number' && age >= 0 && Number.isFinite(age) ? age : null,
    rx: typeof rx === 'number' && rx >= 0 && Number.isFinite(rx) ? rx : null,
    serverId: state === 'connected' ? serverId : null
  }
}

/**
 * Starts a new evidence epoch. Everything that proved something about the old epoch is dropped,
 * and so is the cached address (it belonged to the old route).
 */
function newEpoch(state: HealthState, now: number): HealthState {
  return {
    ...state,
    epoch: state.epoch + 1,
    epochAt: now,
    baselineRx: null,
    evidence: false,
    commAt: null,
    verifyFrom: null,
    verifyFailures: 0,
    unverified: false,
    ip: { info: null, state: 'checking', reason: null, at: 0 }
  }
}

/** Proven at least once in this epoch, and not currently stale-and-unconfirmed. */
export function evidenceFresh(state: HealthState): boolean {
  return state.evidence && !state.unverified
}

/** Check immediately until first proof, and again when communication becomes stale. */
export function verificationDue(state: HealthState): boolean {
  return state.tunnel === 'connected' && (!state.evidence || state.verifyFrom !== null)
}

function later(a: number | null, b: number): number {
  return a === null || b > a ? b : a
}

/**
 * Recomputes staleness from the passage of time alone: whether communication is currently too
 * old (starting or clearing `verifyFrom`), and whether it has been stale long enough, without a
 * successful check, to count as `unverified`. Applied uniformly after every event (see
 * {@link reduceHealth}), so a `status` reading and a `verify` reply drive exactly the same rule.
 */
function withStaleness(state: HealthState, now: number): HealthState {
  if (state.tunnel !== 'connected') {
    if (state.verifyFrom === null && state.verifyFailures === 0 && !state.unverified) return state
    return { ...state, verifyFrom: null, verifyFailures: 0, unverified: false }
  }
  const baseline = state.commAt ?? state.epochAt
  const stale = now - baseline >= state.commStaleMs
  if (!stale) {
    if (state.verifyFrom === null && state.verifyFailures === 0 && !state.unverified) return state
    return { ...state, verifyFrom: null, verifyFailures: 0, unverified: false }
  }
  const verifyFrom = state.verifyFrom ?? now
  const unverified = state.verifyFailures > 0 || now - verifyFrom >= VERIFY_GRACE_MS
  if (verifyFrom === state.verifyFrom && unverified === state.unverified) return state
  return { ...state, verifyFrom, unverified }
}

function applyStatus(state: HealthState, now: number, reading: StatusReading | null): HealthState {
  if (!reading) {
    const statusFailures = state.statusFailures + 1
    if (statusFailures < STATUS_FAILURES_BEFORE_UNKNOWN) return { ...state, statusFailures }
    // Nothing answers: the earlier state cannot be vouched for.
    const changed = state.tunnel !== 'unknown' || state.recoveryRequired
    return {
      ...(changed ? newEpoch(state, now) : state),
      ready: true,
      statusFailures,
      tunnel: 'unknown',
      recoveryRequired: false,
      serverId: null,
      handshakeAge: null,
      rx: null,
      pendingConfirm: null
    }
  }

  let next: HealthState = { ...state, ready: true, statusFailures: 0, pendingConfirm: null }
  const tunnelChanged =
    state.ready && (state.tunnel !== reading.state || state.serverId !== reading.serverId)
  const recoveryChanged = state.recoveryRequired !== reading.recoveryRequired
  if (tunnelChanged || recoveryChanged) next = newEpoch(next, now)

  // What the previous reading of this epoch said (nothing, right after an epoch began).
  const prev = { at: next.lastReadAt, rx: next.rx, age: next.handshakeAge }

  next = {
    ...next,
    tunnel: reading.state,
    recoveryRequired: reading.recoveryRequired,
    serverId: reading.serverId,
    handshakeAge: reading.handshakeAge,
    rx: reading.rx,
    lastReadAt: now
  }

  if (reading.state !== 'connected') return { ...next, evidence: false, baselineRx: null }
  if (next.baselineRx === null) next = { ...next, baselineRx: reading.rx }

  // Real communication since the previous reading: data from the peer, or a newer handshake.
  // Timestamps are conservative (the earlier of the possible moments).
  let commAt = next.commAt
  if (reading.rx !== null && prev.rx !== null && prev.at !== null && reading.rx > prev.rx) {
    commAt = later(commAt, prev.at)
  }
  const handshakeAt = reading.handshakeAge === null ? null : now - (reading.handshakeAge + 1) * 1000
  if (prev.at !== null && prev.age !== null && reading.handshakeAge !== null) {
    // The age did not advance the way time did: a newer handshake replaced the old one.
    const expected = prev.age + (now - prev.at) / 1000
    if (reading.handshakeAge + 1.5 < expected && handshakeAt !== null) {
      commAt = later(commAt, handshakeAt)
    }
  }

  let evidence = next.evidence
  if (!evidence) {
    // A handshake that completed after this window began is new evidence on its own.
    const newHandshake = handshakeAt !== null && handshakeAt >= next.epochAt
    const newData = reading.rx !== null && next.baselineRx !== null && reading.rx > next.baselineRx
    evidence = newHandshake || newData
    if (newHandshake && handshakeAt !== null) commAt = later(commAt, handshakeAt)
    if (evidence && commAt === null) commAt = now
  }

  return { ...next, evidence, commAt }
}

function applyProbe(
  state: HealthState,
  event: Extract<HealthEvent, { type: 'probe' }>
): HealthState {
  if (event.epoch !== state.epoch) return state
  const { result, now } = event
  if (!result.ok) {
    return { ...state, ip: { info: null, state: 'unavailable', reason: state.ip.reason === 'ip-unchanged' ? 'ip-unchanged' : 'ip-unavailable', at: now } }
  }
  const ip = result.ip
  if (state.tunnel === 'disconnected') {
    return { ...state, preVpnIp: ip.ip, ip: { info: ip, state: 'ready', reason: null, at: now } }
  }
  if (state.preVpnIp !== null && ip.ip === state.preVpnIp) {
    // Still the address from before the tunnel: never present it as the VPN's.
    return { ...state, ip: { info: null, state: 'unavailable', reason: 'ip-unchanged', at: now } }
  }
  return { ...state, ip: { info: ip, state: 'ready', reason: null, at: now } }
}

function applyVerify(
  state: HealthState,
  event: Extract<HealthEvent, { type: 'verify' }>
): HealthState {
  if (event.epoch !== state.epoch) return state
  // Real communication already resolved this since the check was requested: a late reply,
  // whichever way it comes out, has nothing left to say. Defense-in-depth against the reducer
  // ever being driven by something other than the real monitor: the monitor itself only ever
  // keeps one `verify()` in flight (see `HealthMonitor.verifying`), so in practice a reply can
  // never outlive its own staleness episode within one epoch — this guard costs nothing and
  // protects the invariant regardless of the caller's own discipline.
  if (state.verifyFrom === null && state.evidence) return state
  if (event.result === 'verified') {
    return {
      ...state,
      evidence: true,
      commAt: event.now,
      verifyFrom: null,
      verifyFailures: 0,
      unverified: false
    }
  }
  if (event.result === 'inconclusive') {
    // A real check was made and found no new evidence -- never proof of loss on its own (see
    // this module's own doc comment), but it does confirm "unverified" right away rather than
    // waiting out the rest of VERIFY_GRACE_MS for a check that already came back empty.
    return { ...state, verifyFailures: state.verifyFailures + 1 }
  }
  // 'error': the check itself could not be made (IPC/local failure, no tunnel, or a tunnel
  // generation race). Says nothing about the tunnel, so nothing here changes.
  return state
}

function reduceCore(state: HealthState, event: HealthEvent): HealthState {
  switch (event.type) {
    case 'status':
      // A reply that was requested before the last epoch change describes a moment we no
      // longer trust: it must not restore anything.
      if (event.epoch !== state.epoch) return state
      return applyStatus(state, event.now, event.reading)
    case 'uplink': {
      if (state.uplink === event.state && state.uplinkKey === event.key) return state
      return newEpoch({ ...state, uplink: event.state, uplinkKey: event.key }, event.now)
    }
    case 'epoch':
      return newEpoch(state, event.now)
    case 'operation':
      if (state.operation === event.operation) return state
      return newEpoch(
        {
          ...state,
          operation: event.operation,
          // Ending an operation opens a new epoch before any status confirms its outcome —
          // remember what just finished so the display keeps following it, not the stale
          // pre-operation `tunnel` this new epoch inherits (cleared once a real reading lands).
          pendingConfirm: event.operation === null ? state.operation : null,
          serverId: event.serverId === undefined ? state.serverId : event.serverId
        },
        event.now
      )
    case 'probe':
      return applyProbe(state, event)
    case 'verify':
      return applyVerify(state, event)
  }
}

/** Every transition, then the same staleness rule applied uniformly (see {@link withStaleness})
 * — a `status` reading and a `verify` reply are judged identically. */
export function reduceHealth(state: HealthState, event: HealthEvent): HealthState {
  const next = reduceCore(state, event)
  if (next === state) return state
  return withStaleness(next, event.now)
}

export function deriveDisplay(state: HealthState): {
  display: HealthDisplay
  reason: HealthReason | null
} {
  if (!state.ready) return { display: 'checking', reason: null }
  if (state.recoveryRequired) return { display: 'blocked', reason: null }
  if (state.operation === 'connecting' || state.pendingConfirm === 'connecting')
    return { display: 'connecting', reason: null }
  if (state.operation !== null || state.pendingConfirm !== null)
    return { display: 'disconnecting', reason: null }
  switch (state.tunnel) {
    case 'unknown':
      return { display: 'unknown', reason: null }
    case 'disconnected':
      return { display: 'disconnected', reason: null }
    case 'connecting':
      return { display: 'connecting', reason: null }
    case 'disconnecting':
      return { display: 'disconnecting', reason: null }
    case 'connected':
      break
  }
  // No physical/virtual uplink is the only thing that honestly proves NO INTERNET for a
  // connected tunnel today — see this module's own doc comment for why a stale `verify` check
  // coming back empty, however many times, never joins it.
  if (state.uplink === 'down') return { display: 'no-internet', reason: 'no-uplink' }
  if (evidenceFresh(state) && state.ip.reason !== 'ip-unchanged')
    return { display: 'protected', reason: null }
  const reason: HealthReason | null =
    state.evidence && state.unverified
      ? 'stale'
      : evidenceFresh(state) && state.ip.state === 'unavailable'
        ? (state.ip.reason ?? 'ip-unavailable')
        : null
  return { display: 'verifying', reason }
}

export function snapshotOf(state: HealthState, revision: number): HealthSnapshot {
  const { display, reason } = deriveDisplay(state)
  return {
    revision,
    display,
    reason,
    network: state.uplink,
    operation: state.operation,
    serverId: state.tunnel === 'connected' || state.operation !== null ? state.serverId : null,
    publicIp: state.ip.state === 'ready' ? state.ip.info : null,
    ipState: state.ip.state,
    tunnelUp: state.tunnel === 'connected'
  }
}

/** Whether two snapshots differ in anything a user can see (the revision itself is ignored). */
export function sameHealth(a: HealthSnapshot, b: HealthSnapshot): boolean {
  return (
    a.display === b.display &&
    a.reason === b.reason &&
    a.network === b.network &&
    a.operation === b.operation &&
    a.serverId === b.serverId &&
    a.ipState === b.ipState &&
    a.tunnelUp === b.tunnelUp &&
    a.publicIp?.ip === b.publicIp?.ip &&
    a.publicIp?.countryCode === b.publicIp?.countryCode &&
    a.publicIp?.countryName === b.publicIp?.countryName
  )
}

const DISPLAYS: readonly string[] = [
  'checking',
  'unknown',
  'blocked',
  'disconnected',
  'connecting',
  'disconnecting',
  'verifying',
  'protected',
  'no-internet'
]
const REASONS: readonly string[] = [
  'no-uplink',
  'no-response',
  'ip-unavailable',
  'ip-unchanged',
  'stale'
]

/** Structural check for a value that crossed the IPC boundary. */
export function isHealthSnapshot(value: unknown): value is HealthSnapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  const ip = s.publicIp
  return (
    typeof s.revision === 'number' &&
    Number.isInteger(s.revision) &&
    typeof s.display === 'string' &&
    DISPLAYS.includes(s.display) &&
    (s.reason === null || (typeof s.reason === 'string' && REASONS.includes(s.reason))) &&
    (s.network === 'unknown' || s.network === 'up' || s.network === 'down') &&
    (s.operation === null ||
      s.operation === 'connecting' ||
      s.operation === 'disconnecting' ||
      s.operation === 'quitting') &&
    (s.serverId === null || typeof s.serverId === 'string') &&
    (s.ipState === 'checking' || s.ipState === 'ready' || s.ipState === 'unavailable') &&
    typeof s.tunnelUp === 'boolean' &&
    (ip === null ||
      (typeof ip === 'object' &&
        typeof (ip as Record<string, unknown>).ip === 'string' &&
        ((ip as Record<string, unknown>).countryCode === null ||
          typeof (ip as Record<string, unknown>).countryCode === 'string') &&
        ((ip as Record<string, unknown>).countryName === null ||
          typeof (ip as Record<string, unknown>).countryName === 'string')))
  )
}

/** The initial snapshot before anything is known. */
export const CHECKING_SNAPSHOT: HealthSnapshot = {
  revision: -1,
  display: 'checking',
  reason: null,
  network: 'unknown',
  operation: null,
  serverId: null,
  publicIp: null,
  ipState: 'checking',
  tunnelUp: false
}
