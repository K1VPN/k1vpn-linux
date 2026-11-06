export type Screen =
  'loading' | 'notice' | 'login' | 'connect' | 'menu' | 'account' | 'settings' | 'dns' | 'about'

export type VpnStatus =
  | 'checking'
  | 'unknown'
  | 'disconnected'
  | 'connecting'
  | 'verifying'
  | 'connected'
  | 'disconnecting'

/**
 * Deliberately has no WireGuard fields (private key, public key, IP) — the
 * main process keeps those (authClient.ts's `currentAccount`) for a future
 * connect flow, never sending them across IPC to the renderer at all.
 */
export interface VpnAccount {
  id: number
  username: string
  status: string
  isActive: boolean
  expiredAt: string | null
  createdAt: string
  updatedAt: string
}

/** Matches preload's `DesktopServer` (see preload/index.d.ts) — what `window.api.vpn.listServers()` resolves to. */
export interface Server {
  id: string
  countryCode: string
  countryName: string
  city: string | null
  label: string | null
  isRecommended: boolean
  isFeatured: boolean
  loadPercent: number | null
}
