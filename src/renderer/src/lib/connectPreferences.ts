export type ServerTab = 'all' | 'favorites'
export interface ConnectPreferences {
  readonly serverId: string
  readonly tab: ServerTab
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
const DEFAULTS: ConnectPreferences = { serverId: '', tab: 'all' }
const storageKey = (account: string): string =>
  `k1vpn-connect-preferences:${encodeURIComponent(account)}`

/** UI choices only, scoped to the account. Memory survives screen changes even if storage fails. */
export class ConnectPreferencesStore {
  private readonly entries = new Map<string, ConnectPreferences>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: () => PreferenceStorage) {}

  read(account: string): ConnectPreferences {
    const cached = this.entries.get(account)
    if (cached) return cached
    let preferences = DEFAULTS
    try {
      const raw = this.storage().getItem(storageKey(account))
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>
        preferences = {
          serverId: typeof value.serverId === 'string' ? value.serverId : '',
          tab: value.tab === 'favorites' ? 'favorites' : 'all'
        }
      }
    } catch {
      // A storage or parsing failure must not prevent connecting.
    }
    this.entries.set(account, preferences)
    return preferences
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  rememberConnection(
    account: string,
    snapshot: { tunnelUp: boolean; serverId: string | null }
  ): void {
    if (snapshot.tunnelUp && snapshot.serverId) {
      this.update(account, { serverId: snapshot.serverId })
    }
  }

  update(account: string, change: Partial<ConnectPreferences>): void {
    const previous = this.read(account)
    const next = { ...previous, ...change }
    if (next.serverId === previous.serverId && next.tab === previous.tab) return
    this.entries.set(account, next)
    try {
      this.storage().setItem(storageKey(account), JSON.stringify(next))
    } catch {
      // Keep the choice for this session when persistent storage is unavailable.
    }
    for (const listener of [...this.listeners]) listener()
  }
}

export const connectPreferences = new ConnectPreferencesStore(() => window.localStorage)

/** Never offer a remembered server that is missing from the account's available list. */
export function availableSelectedServer(
  preferences: ConnectPreferences,
  servers: readonly { id: string }[]
): string {
  return servers.some((server) => server.id === preferences.serverId) ? preferences.serverId : ''
}
