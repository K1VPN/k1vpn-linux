import type { HealthSnapshot } from './connectionHealth'
import type { DnsMode, DnsSettings } from './dns'
import type { UpdateState } from './updates'

export interface Server { id: string; countryCode: string; countryName: string; city: string | null; label: string | null; isRecommended: boolean; isFeatured: boolean; loadPercent: number | null }
export interface VpnAccountInfo { id: number; username: string; status: string; isActive: boolean; expiredAt: string | null; createdAt: string; updatedAt: string }
export interface Settings { autoStart: boolean; autoConnect: boolean; killSwitch: boolean; allowLocalNetwork?: boolean; dns: DnsSettings }

export interface AutoConnectErrorInfo { id: number; code: string; message: string }

export interface ClientApi {
  updates: { get(): Promise<UpdateState>; check(): Promise<UpdateState>; install(): Promise<UpdateState> }
  settings: { get(): Promise<Settings>; set(key: 'autoStart' | 'autoConnect' | 'killSwitch' | 'allowLocalNetwork', value: boolean): Promise<Settings>; setDns(mode: DnsMode, custom: string[]): Promise<Settings> }
  app: { quit(): Promise<void>; setLanguage(language: 'el' | 'en'): Promise<void> }
  vpn: {
    restartService(): Promise<void>; ping(): Promise<unknown>; status(): Promise<unknown>; connect(serverId: string): Promise<unknown>; disconnect(): Promise<unknown>; listServers(): Promise<Server[]>; publicIp(): Promise<unknown>
    autoConnectError: { get(): Promise<AutoConnectErrorInfo | null>; acknowledge(id: number): Promise<void>; subscribe(listener: (error: unknown) => void): () => void }
    health: { get(): Promise<HealthSnapshot>; refresh(): Promise<void>; allowLookup(): Promise<void>; subscribe(listener: (snapshot: unknown) => void): () => void }
  }
  auth: {
    forgetCredentials(): Promise<void>; login(username: string, password: string, remember: boolean): Promise<VpnAccountInfo>; getRememberedLogin(): Promise<{ username: string } | null>; loginWithSavedCredentials(): Promise<VpnAccountInfo>; restoreSession(): Promise<VpnAccountInfo | null>; refreshAccount(): Promise<VpnAccountInfo>; logout(): Promise<void>
  }
}
