import { AuthSessionError } from './authManager'
import { VpnDaemonError } from './daemonClient'

import type { AutoConnectErrorInfo } from '../shared/contracts'

/** At most one startup attempt; explicit user actions always supersede it. */
export class AutoConnect {
  private revision = 0
  private consumed = false

  constructor(
    private readonly deps: {
      server: (username: string) => string | null
      isCurrent: (username: string) => boolean
      connect: (serverId: string, stillCurrent: () => boolean) => Promise<unknown>
      error: (error: unknown) => void
    }
  ) {}

  cancel(): void {
    ++this.revision
    this.consumed = true
  }

  async start(username: string): Promise<void> {
    if (this.consumed) return
    this.consumed = true
    const revision = this.revision
    const stillCurrent = (): boolean => revision === this.revision && this.deps.isCurrent(username)
    try {
      const server = this.deps.server(username)
      if (!server || !stillCurrent()) return
      await this.deps.connect(server, stillCurrent)
    } catch (error) {
      if (revision === this.revision) this.deps.error(error)
    }
  }
}

const DAEMON_CODES: Readonly<Record<string, string>> = {
  authorization_required: 'VPN_PERMISSION',
  snap_interfaces_missing: 'SNAP_PERMISSION',
  invalid_tunnel_config: 'CONFIG',
  busy: 'BUSY'
}

/** Stable, translatable failure codes; service messages are never shown to the user. */
export function autoConnectErrorCode(error: unknown): string {
  if (error instanceof AuthSessionError) return error.code
  if (error instanceof VpnDaemonError) return DAEMON_CODES[error.code] ?? 'VPN'
  if (error instanceof TypeError) return 'CONFIG'
  return 'INTERNAL'
}

/** Holds the one pending failure until the user acknowledges it. */
export class AutoConnectErrorState {
  private current: AutoConnectErrorInfo | null = null
  private nextId = 1

  constructor(private readonly emit: (error: AutoConnectErrorInfo | null) => void) {}

  get(): AutoConnectErrorInfo | null {
    return this.current
  }

  report(error: unknown): void {
    this.current = { id: this.nextId++, code: autoConnectErrorCode(error), message: 'Automatic connection failed.' }
    this.emit(this.current)
  }

  /** An id-scoped acknowledgement never clears a newer failure it did not show. */
  acknowledge(id: unknown): void {
    if (typeof id !== 'number' || this.current?.id !== id) return
    this.current = null
    this.emit(null)
  }
}
