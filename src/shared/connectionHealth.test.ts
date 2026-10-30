import { describe, expect, it } from 'vitest'
import {
  COMM_STALE_MS,
  VERIFY_GRACE_MS,
  verificationDue,
  deriveDisplay,
  initialHealthState,
  isHealthSnapshot,
  parseStatusReading,
  reduceHealth,
  sameHealth,
  snapshotOf,
  type HealthEvent,
  type HealthState,
  type StatusReading
} from './connectionHealth'

const IP = { ip: '203.0.113.9', countryCode: 'NL', countryName: 'Netherlands' }
const HOME_IP = { ip: '198.51.100.7', countryCode: 'GR', countryName: 'Greece' }

function reading(over: Partial<StatusReading> = {}): StatusReading {
  return {
    state: 'connected',
    recoveryRequired: false,
    handshakeAge: 3,
    rx: 1000,
    serverId: 'nl-1',
    ...over
  }
}

/** Drives the reducer like the monitor does: every request carries the epoch it started in. */
class Harness {
  state: HealthState
  now = 0
  constructor(options: { commStaleMs?: number } = {}) {
    this.state = initialHealthState(0, options)
  }
  send(event: HealthEvent): void {
    this.state = reduceHealth(this.state, event)
  }
  status(r: StatusReading | null, epoch = this.state.epoch): void {
    this.send({ type: 'status', now: this.now, epoch, reading: r })
  }
  probeOk(ip = IP, epoch = this.state.epoch): void {
    this.send({ type: 'probe', now: this.now, epoch, result: { ok: true, ip } })
  }
  /** A failed *address lookup* (client-ip endpoint) -- display only; never affects verification or loss. */
  probeFail(epoch = this.state.epoch): void {
    this.send({ type: 'probe', now: this.now, epoch, result: { ok: false } })
  }
  /** The daemon's own check succeeding: real new evidence (a fresh handshake or new data). */
  verifyOk(epoch = this.state.epoch): void {
    this.send({ type: 'verify', now: this.now, epoch, result: 'verified' })
  }
  /** The daemon's own check running for real and finding nothing new -- never proof of loss on
   * its own (see connectionHealth.ts's own doc comment). */
  verifyFail(epoch = this.state.epoch): void {
    this.send({ type: 'verify', now: this.now, epoch, result: 'inconclusive' })
  }
  /** The check itself could not even be made (IPC/local failure, no tunnel, or a tunnel
   * generation race) -- must never count toward anything. */
  verifyError(epoch = this.state.epoch): void {
    this.send({ type: 'verify', now: this.now, epoch, result: 'error' })
  }
  uplink(state: 'up' | 'down' | 'unknown', key = state === 'up' ? '14:wifi:4' : ''): void {
    this.send({ type: 'uplink', now: this.now, state, key })
  }
  advance(ms: number): void {
    this.now += ms
  }
  get display(): string {
    return deriveDisplay(this.state).display
  }
  get reason(): string | null {
    return deriveDisplay(this.state).reason
  }

  /** A connected, verified, protected session on an up network. */
  protectedSession(): void {
    this.uplink('up')
    this.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    this.probeOk(HOME_IP)
    this.status(reading({ state: 'connected', rx: 1000, handshakeAge: 0 }))
    this.advance(1000)
    this.probeOk(IP)
    this.advance(500)
    this.status(reading({ rx: 1900, handshakeAge: 1 }))
  }
}

describe('parseStatusReading', () => {
  it('reads the daemon status, including the receive counter', () => {
    expect(
      parseStatusReading(
        { state: 'connected', last_handshake_secs_ago: 4, rx_bytes: 99, tx_bytes: 5 },
        'gr-1'
      )
    ).toEqual({
      state: 'connected',
      recoveryRequired: false,
      handshakeAge: 4,
      rx: 99,
      serverId: 'gr-1'
    })
  })

  it('accepts a daemon that does not report counters and rejects anything else', () => {
    expect(parseStatusReading({ state: 'disconnected' }, 'x')?.rx).toBeNull()
    expect(parseStatusReading({ state: 'disconnected' }, 'x')?.serverId).toBeNull()
    expect(parseStatusReading({ state: 'weird' }, null)).toBeNull()
    expect(parseStatusReading(null, null)).toBeNull()
    expect(
      parseStatusReading({ state: 'connected', last_handshake_secs_ago: -1 }, null)?.handshakeAge
    ).toBeNull()
  })

  it('keeps recovery_required', () => {
    expect(
      parseStatusReading({ state: 'disconnected', recovery_required: true }, null)?.recoveryRequired
    ).toBe(true)
  })
})

describe('Protected is earned', () => {
  it('is never shown for an old handshake alone', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ handshakeAge: 5, rx: 500 }))
    expect(h.display).toBe('verifying')
    h.probeOk(IP)
    // The address answered, but the daemon has shown no new data yet.
    expect(h.display).toBe('verifying')
  })

  it('needs new data or a new handshake in this epoch', () => {
    const h = new Harness()
    h.protectedSession()
    expect(h.display).toBe('protected')
    expect(h.reason).toBeNull()
  })

  it('accepts a handshake that completed after the epoch began', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    h.advance(10_000)
    h.status(reading({ handshakeAge: 0, rx: null }))
    h.advance(5000)
    h.status(reading({ handshakeAge: 2, rx: null }))
    h.probeOk(IP)
    expect(h.display).toBe('protected')
  })

  it('does not accept a handshake that could have completed before the epoch began', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ handshakeAge: 0, rx: null }))
    h.advance(200)
    h.uplink('up', '9:ethernet:4') // handover: a new epoch starts now
    h.advance(300)
    h.status(reading({ handshakeAge: 0, rx: null }))
    h.probeOk(IP)
    // The handshake may be 999 ms old, older than the handover.
    expect(h.display).toBe('verifying')
  })

  it('shows protection from fresh tunnel evidence while the address is still checking', () => {
    const h = new Harness()
    h.protectedSession()
    h.uplink('up', '9:ethernet:4')
    h.status(reading({ rx: 5000, handshakeAge: 0 }))
    h.advance(1000)
    h.status(reading({ rx: 5100, handshakeAge: 1 }))
    expect(h.display).toBe('protected')
    expect(h.state.ip.state).toBe('checking')
    h.probeOk(IP)
    expect(h.display).toBe('protected')
  })

  it('does not take an address equal to the pre-VPN address as the VPN address', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    h.probeOk(HOME_IP)
    expect(h.state.preVpnIp).toBe(HOME_IP.ip)
    h.status(reading({ rx: 10, handshakeAge: 0 }))
    h.advance(1000)
    h.status(reading({ rx: 200, handshakeAge: 1 }))
    h.probeOk(HOME_IP)
    expect(h.display).toBe('verifying')
    expect(h.state.ip.state).toBe('unavailable')
    expect(snapshotOf(h.state, 0).publicIp).toBeNull()
    h.probeFail()
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('ip-unchanged')
    h.probeOk(IP)
    expect(h.display).toBe('protected')
  })
})

describe('the physical network', () => {
  it('shows NO INTERNET at once when the uplink disappears under a live tunnel', () => {
    const h = new Harness()
    h.protectedSession()
    h.advance(100)
    h.uplink('down')
    expect(h.display).toBe('no-internet')
    expect(h.reason).toBe('no-uplink')
    expect(snapshotOf(h.state, 1).tunnelUp).toBe(true)
  })

  it('keeps a disconnected VPN red while offline', () => {
    const h = new Harness()
    h.uplink('down')
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    expect(h.display).toBe('disconnected')
  })

  it('does not hide recovery-required or an unreadable service behind being offline', () => {
    const h = new Harness()
    h.uplink('down')
    h.status(
      reading({
        state: 'disconnected',
        recoveryRequired: true,
        handshakeAge: null,
        rx: null,
        serverId: null
      })
    )
    expect(h.display).toBe('blocked')
    const g = new Harness()
    g.uplink('down')
    g.status(null)
    g.status(null)
    expect(g.display).toBe('unknown')
  })

  it('does not call a lost Wi-Fi a loss while Ethernet is still an uplink', () => {
    const h = new Harness()
    h.protectedSession()
    h.advance(100)
    // Wi-Fi went away, Ethernet remains: an uplink exists, only its identity changed.
    h.uplink('up', '9:ethernet:4')
    expect(h.display).toBe('verifying')
  })

  it('treats an unknown uplink as no information, never as a loss', () => {
    const h = new Harness()
    h.protectedSession()
    h.uplink('unknown', '')
    expect(h.display).not.toBe('no-internet')
  })

  it('needs fresh proof after the network returns; nothing from before counts', () => {
    const h = new Harness()
    h.protectedSession()
    h.advance(100)
    h.uplink('down')
    h.advance(20_000)
    h.uplink('up')
    expect(h.display).toBe('verifying')
    // The old counters and the old handshake (age 21 s) prove nothing about the new uplink.
    h.status(reading({ rx: 1900, handshakeAge: 21 }))
    h.probeOk(IP)
    expect(h.display).toBe('verifying')
    h.advance(1000)
    h.status(reading({ rx: 2500, handshakeAge: 1 }))
    expect(h.display).toBe('protected')
  })
})

describe('late replies from before a change', () => {
  it('a status read that started before the uplink came back cannot restore Protected', () => {
    const h = new Harness()
    h.protectedSession()
    const oldEpoch = h.state.epoch
    h.advance(100)
    h.uplink('down')
    h.advance(5000)
    h.uplink('up')
    h.advance(50)
    // The first reading of the new epoch: the baseline.
    h.status(reading({ rx: 1900, handshakeAge: 21 }))
    h.advance(2000)
    // The reply that was in flight before the loss arrives now, looking like fresh proof.
    h.status(reading({ rx: 99_999, handshakeAge: 0 }), oldEpoch)
    h.probeOk(IP)
    expect(h.state.evidence).toBe(false)
    expect(h.display).toBe('verifying')
  })

  it('a lookup that started before the change cannot make an address ready', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ rx: 1 }))
    const epoch = h.state.epoch
    h.uplink('down')
    h.probeOk(IP, epoch)
    expect(h.state.ip.state).toBe('checking')
  })

  it('a verify reply that started before the epoch changed cannot restore anything', () => {
    const h = new Harness()
    h.protectedSession()
    const oldEpoch = h.state.epoch
    h.uplink('down')
    h.uplink('up', '9:ethernet:4')
    h.verifyOk(oldEpoch)
    expect(h.display).not.toBe('protected')
  })

  it('a verify reply from a gone epoch is rejected even while the current epoch is itself stale', () => {
    const h = new Harness()
    h.protectedSession()
    const oldEpoch = h.state.epoch
    h.uplink('down')
    h.uplink('up', '9:ethernet:4') // a new epoch begins
    idleFor(h, 200, 1, true) // this new epoch goes stale before ever being proven
    expect(verificationDue(h.state)).toBe(true)
    const verifyFrom = h.state.verifyFrom
    // A reply to the *old* epoch's check, arriving only now: it must not settle the current
    // epoch's own, still-open check, however plausible-looking the "ok" would be.
    h.verifyOk(oldEpoch)
    expect(h.state.evidence).toBe(false)
    expect(h.state.verifyFrom).toBe(verifyFrom)
    expect(verificationDue(h.state)).toBe(true)
  })

  it('the counter of an earlier epoch is not the baseline of the next one', () => {
    const h = new Harness()
    h.protectedSession() // baseline 1000 in the first epoch
    h.advance(100)
    h.uplink('down')
    h.advance(3000)
    h.uplink('up')
    h.advance(50)
    // The first reading after the network came back already shows more than the old baseline.
    h.status(reading({ rx: 1900, handshakeAge: 20 }))
    h.probeOk(IP)
    expect(h.state.baselineRx).toBe(1900)
    expect(h.state.evidence).toBe(false)
    expect(h.display).toBe('verifying')
  })

  it('counter growth measured before the first reading of the epoch is not evidence', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ rx: 10_000, handshakeAge: 50 }))
    h.advance(3000)
    h.probeOk(IP)
    // The baseline is the first reading of the epoch, not an older number.
    expect(h.state.baselineRx).toBe(10_000)
    expect(h.state.evidence).toBe(false)
  })
})

/** Idle: nothing flows, the counter stands still, the handshake only gets older. */
function idleFor(h: Harness, seconds: number, every = 5, stopWhenDue = false): void {
  const startAge = h.state.handshakeAge ?? 0
  const t0 = h.now
  for (let elapsed = every; elapsed <= seconds; elapsed += every) {
    h.now = t0 + elapsed * 1000
    h.status(reading({ rx: h.state.rx ?? 0, handshakeAge: startAge + elapsed }))
    if (stopWhenDue && verificationDue(h.state)) return
  }
}

function connectedAndProven(): Harness {
  const h = new Harness()
  h.protectedSession()
  return h
}

describe("the address lookup never decides loss -- only the daemon's own check does", () => {
  it('however the address lookup fails, and however often, it never confirms a loss on its own', () => {
    const h = connectedAndProven()
    for (let i = 0; i < 20; i++) {
      h.advance(2000)
      h.probeFail()
    }
    // 40 s pass with no real communication either: time alone makes this merely unverified.
    // Address-lookup failures never caused that -- no real check (verify) ever failed.
    expect(h.state.verifyFailures).toBe(0)
  })

  it('a failing lookup makes only the address unavailable -- never NO INTERNET, never unverified', () => {
    const h = connectedAndProven()
    h.probeFail()
    // The tunnel itself is still proven (no time passed, no check failed): only the address
    // could not be shown. This is not the same as a lost connection.
    expect(h.display).toBe('protected')
    expect(h.reason).toBeNull()
    expect(snapshotOf(h.state, 0).ipState).toBe('unavailable')
    expect(h.state.evidence).toBe(true)
    expect(h.state.unverified).toBe(false)
    expect(h.state.verifyFailures).toBe(0)
  })

  it('a lookup failure while the tunnel is genuinely silent still does not by itself confirm a loss', () => {
    const h = connectedAndProven()
    idleFor(h, 200, 1, true) // now unverified, waiting on a real check
    for (let i = 0; i < 10; i++) {
      h.advance(2000)
      h.probeFail()
    }
    expect(h.state.verifyFailures).toBe(0)
  })
})

describe('proof goes stale without waiting for the session to expire', () => {
  it('reproduces the 168 s case: Protected without any new data no longer survives', () => {
    const h = new Harness()
    h.protectedSession()
    expect(h.display).toBe('protected')
    // Idle, no check made (a monitor that never checked): well past the staleness limit.
    idleFor(h, 168)
    expect(h.display).not.toBe('protected')
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
  })

  it('asks for a check once communication is older than the limit, long before 180 s', () => {
    const h = new Harness()
    h.protectedSession()
    expect(verificationDue(h.state)).toBe(false)
    idleFor(h, 200, 1, true)
    expect(verificationDue(h.state)).toBe(true)
    expect(h.now).toBeGreaterThanOrEqual(COMM_STALE_MS)
    expect(h.now).toBeLessThan(COMM_STALE_MS + 10_000)
    // Still green while the check is under way (an idle tunnel must not flicker)...
    expect(h.display).toBe('protected')
  })

  it('stays green for the length of the check, and not beyond it if it does not complete', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    const dueAt = h.now
    h.now = dueAt + VERIFY_GRACE_MS - 500
    expect(h.display).toBe('protected')
    h.now = dueAt + VERIFY_GRACE_MS
    h.status(reading({ rx: h.state.rx ?? 0, handshakeAge: h.state.handshakeAge ?? 0 }))
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
  })

  it('the grace period is not renewed by polling alone, and staying unverified never escalates on its own', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    const dueAt = h.now
    const staleReading = reading({ rx: h.state.rx ?? 0, handshakeAge: h.state.handshakeAge ?? 0 })
    // Many status polls, none of them a real check: none may push the grace window out.
    for (let i = 0; i < 60; i++) {
      h.advance(50)
      h.status(staleReading)
    }
    expect(h.now - dueAt).toBeLessThan(VERIFY_GRACE_MS)
    expect(h.display).toBe('protected')
    h.now = dueAt + VERIFY_GRACE_MS
    h.status(staleReading)
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
    const verifyFrom = h.state.verifyFrom
    // Continuing to poll, still with no real check, changes nothing: polling alone can neither
    // resolve nor escalate a stale check.
    for (let i = 0; i < 60; i++) {
      h.advance(50)
      h.status(staleReading)
    }
    expect(h.state.verifyFrom).toBe(verifyFrom)
    expect(h.display).toBe('verifying')
    // However long it stays unverified -- there is no reliable active check beyond `verify`
    // itself (see connectionHealth.ts's own doc comment) -- it never becomes anything stronger
    // than "verifying/stale" while the uplink is up.
    h.advance(10 * 60_000)
    h.status(staleReading)
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
  })

  it('a successful check keeps an idle tunnel green, needed roughly once a staleness window', () => {
    const h = new Harness()
    h.protectedSession()
    let checks = 0
    for (let seconds = 0; seconds < 600; seconds++) {
      h.advance(1000)
      // Idle sessions are rekeyed every 120 s: the handshake age drops back to zero on its own.
      h.status(reading({ rx: h.state.rx ?? 0, handshakeAge: (1 + seconds) % 120 }))
      if (verificationDue(h.state)) {
        checks++
        h.verifyOk()
      }
      expect(h.display, `second ${seconds}`).toBe('protected')
    }
    // Bounded and not zero: real, occasional checks, not a check on every poll tick.
    expect(checks).toBeGreaterThan(0)
    expect(checks).toBeLessThan(600 / 10)
  })

  it('a single failed check makes it unverified, never a confirmed loss', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    h.verifyFail()
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
  })

  it('an IPC/local error from the check counts toward nothing: it says nothing about the tunnel', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    const before = h.state
    h.verifyError()
    // A no-op at the reducer level -- unlike a real (inconclusive) check, an error must not even
    // move the state to "unverified" ahead of the rest of the grace window.
    expect(h.state).toBe(before)
    expect(h.display).toBe('protected')
  })

  it('repeated inconclusive checks, however many and however long, never become a confirmed NO INTERNET on their own', () => {
    // The exact case A3 exists for: a probe through an already-valid session never forces a
    // fresh handshake, so a real, honestly-implemented check on a perfectly healthy but quiet
    // tunnel looks identical to one that has actually gone dark -- neither ever produces new
    // evidence. Without a real responding endpoint (a separate, undecided dependency), that
    // absence can only ever mean "still unverified," never "confirmed lost."
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    for (let i = 0; i < 50; i++) {
      h.advance(5000)
      h.verifyFail()
    }
    expect(h.now).toBeGreaterThan(250_000) // well past any timeout the old design would have used
    expect(h.display).not.toBe('no-internet')
    expect(h.display).toBe('verifying')
    expect(h.reason).toBe('stale')
    expect(h.state.uplink).toBe('up') // the only thing that could honestly make this no-internet
  })

  it('recovers to Protected as soon as a check succeeds after being unverified', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    h.verifyFail()
    expect(h.display).toBe('verifying')
    h.advance(1000)
    h.verifyOk()
    expect(h.display).toBe('protected')
    expect(verificationDue(h.state)).toBe(false)
    expect(h.state.verifyFailures).toBe(0)
  })

  it('recovers to Protected when real communication resumes on its own, even without a check', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    h.verifyFail()
    h.advance(1000)
    h.status(reading({ rx: (h.state.rx ?? 0) + 5000, handshakeAge: 0 }))
    h.advance(1000)
    h.status(reading({ rx: (h.state.rx ?? 0) + 100, handshakeAge: 1 }))
    expect(h.display).toBe('protected')
    expect(verificationDue(h.state)).toBe(false)
  })

  it('a newer handshake counts as communication (the session was rekeyed)', () => {
    const h = new Harness({ commStaleMs: 100_000 })
    h.protectedSession()
    // Idle for 95 s, then the session is rekeyed (age drops), then idle again to 130 s.
    idleFor(h, 95)
    h.advance(5000)
    h.status(reading({ rx: h.state.rx ?? 0, handshakeAge: 0 }))
    h.advance(35_000)
    h.status(reading({ rx: h.state.rx ?? 0, handshakeAge: 35 }))
    // Without the rekey counted, communication would be 130 s old, past the 100 s limit.
    expect(verificationDue(h.state)).toBe(false)
    expect(h.display).toBe('protected')
  })

  it('a new epoch forgets what was seen: nothing carried over can keep it green or make it stale', () => {
    const h = new Harness()
    h.protectedSession()
    idleFor(h, 200, 1, true)
    expect(verificationDue(h.state)).toBe(true)
    h.uplink('up', '9:ethernet:4')
    expect(h.state.commAt).toBeNull()
    expect(h.state.verifyFrom).toBeNull()
    expect(h.state.verifyFailures).toBe(0)
    expect(h.state.unverified).toBe(false)
    expect(h.display).toBe('verifying')
  })

  it('a daemon without counters still gets checked once its last known handshake is old enough', () => {
    const h = new Harness()
    h.uplink('up')
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    h.probeOk(HOME_IP)
    h.status(reading({ handshakeAge: 0, rx: null }))
    h.advance(5000)
    // A handshake that completed after the epoch began: the only evidence such a daemon can give.
    h.status(reading({ handshakeAge: 0, rx: null }))
    h.probeOk(IP)
    expect(h.display).toBe('protected')
    h.advance(120_000)
    h.status(reading({ handshakeAge: 100, rx: null }))
    // No counters to show new data, and the implied handshake time is stale: exactly the
    // protection a counter-less daemon most needs -- it has no other way to prove itself.
    expect(verificationDue(h.state)).toBe(true)
    expect(h.display).toBe('protected') // still green for the grace window while it is checked
    h.advance(VERIFY_GRACE_MS)
    h.status(reading({ handshakeAge: 100, rx: null }))
    expect(h.display).toBe('verifying')
    h.verifyOk()
    expect(h.display).toBe('protected')
  })
})

describe('the daemon', () => {
  it('is "checking" before the first answer', () => {
    const h = new Harness()
    expect(h.display).toBe('checking')
    h.status(null)
    expect(h.display).toBe('checking') // one miss is not an outage
    h.status(null)
    expect(h.display).toBe('unknown')
  })

  it('an unreadable daemon is unknown, not disconnected, and not NO INTERNET', () => {
    const h = new Harness()
    h.protectedSession()
    h.status(null)
    h.status(null)
    expect(h.display).toBe('unknown')
    h.uplink('down')
    expect(h.display).toBe('unknown')
  })

  it('a changed tunnel state starts a new epoch', () => {
    const h = new Harness()
    h.protectedSession()
    const epoch = h.state.epoch
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    expect(h.state.epoch).toBe(epoch + 1)
    expect(h.display).toBe('disconnected')
    expect(h.state.evidence).toBe(false)
  })

  it('follows an operation and ignores what was read before it', () => {
    const h = new Harness()
    h.protectedSession()
    const old = h.state.epoch
    h.send({ type: 'operation', now: h.now, operation: 'disconnecting' })
    expect(h.display).toBe('disconnecting')
    h.status(reading({ rx: 5000, handshakeAge: 0 }), old)
    expect(h.display).toBe('disconnecting')
    h.send({ type: 'operation', now: h.now, operation: null })
    h.status(reading({ state: 'disconnected', handshakeAge: null, rx: null, serverId: null }))
    expect(h.display).toBe('disconnected')
  })
})

describe('snapshots', () => {
  it('only differ where a user could see it', () => {
    const h = new Harness()
    h.protectedSession()
    const a = snapshotOf(h.state, 3)
    h.advance(5000)
    h.status(reading({ rx: 2500, handshakeAge: 4 }))
    expect(sameHealth(a, snapshotOf(h.state, 4))).toBe(true)
    h.uplink('down')
    expect(sameHealth(a, snapshotOf(h.state, 5))).toBe(false)
  })

  it('validate at the IPC boundary', () => {
    const h = new Harness()
    h.protectedSession()
    const s = snapshotOf(h.state, 1)
    expect(isHealthSnapshot(s)).toBe(true)
    expect(isHealthSnapshot({ ...s, display: 'green' })).toBe(false)
    expect(isHealthSnapshot({ ...s, publicIp: { ip: 5 } })).toBe(false)
    expect(isHealthSnapshot(null)).toBe(false)
  })
})
