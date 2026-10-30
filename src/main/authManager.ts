import * as defaultApi from './apiClient'
import { ApiError, ApiProtocolError, ApiUnreachableError, type DesktopServer, type VpnAccount, type WireguardPeerConfig } from './apiClient'
import { CredentialStoreError, type Credentials } from './credentialStore'
import type { VpnAccountInfo } from '../shared/contracts'

export interface CredentialPort {
  read(): Promise<Credentials | null>
  rememberedLogin(): Promise<{ username: string } | null>
  saveIfCurrent(username: string, password: string, isCurrent: () => boolean): Promise<boolean>
  forgetIfCurrent(isCurrent: () => boolean): boolean
}

export interface SignedOutPort { get(): boolean; set(value: boolean): void }
export interface AuthApi {
  fetchAccount(username: string, password: string): Promise<VpnAccount>
  fetchServers(username: string, password: string): Promise<DesktopServer[]>
  fetchWireguardConfig(username: string, password: string, serverId: string): Promise<WireguardPeerConfig>
}

interface PrivateAccount extends VpnAccountInfo {
  password: string
  wgIp: string | null
  wgPrivateKey: string | null
  wgPublicKey: string | null
}

export class AuthSessionError extends Error {
  constructor(readonly code: 'AUTH' | 'NETWORK' | 'PROTOCOL' | 'SUPERSEDED', message: string) {
    super(message)
    this.name = 'AuthSessionError'
  }
}

function translate(error: unknown): Error {
  if (error instanceof AuthSessionError || error instanceof CredentialStoreError || error instanceof TypeError) return error
  if (error instanceof ApiError) {
    return new AuthSessionError(error.status === 401 || error.status === 403 ? 'AUTH' : 'NETWORK', error.message)
  }
  if (error instanceof ApiUnreachableError) return new AuthSessionError('NETWORK', error.message)
  if (error instanceof ApiProtocolError) return new AuthSessionError('PROTOCOL', error.message)
  return new AuthSessionError('NETWORK', 'K1VPN request failed. Please try again.')
}

function publicInfo(account: PrivateAccount): VpnAccountInfo {
  return {
    id: account.id,
    username: account.username,
    status: account.status,
    isActive: account.isActive,
    expiredAt: account.expiredAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

export class AuthManager {
  private current: PrivateAccount | null = null
  private generation = 0

  constructor(
    private readonly credentials: CredentialPort,
    private readonly signedOut: SignedOutPort,
    private readonly api: AuthApi = defaultApi,
    private readonly now: () => number = Date.now
  ) {}

  private begin(): number {
    this.generation += 1
    this.current = null
    return this.generation
  }

  private isCurrent(token: number): boolean { return token === this.generation }
  private superseded(): AuthSessionError { return new AuthSessionError('SUPERSEDED', 'This operation was superseded by a newer login or logout.') }

  private async activeAccount(username: string, password: string): Promise<PrivateAccount> {
    const account = await this.api.fetchAccount(username, password)
    const active = account.status === 'Active' && (account.expiredAt === null || Date.parse(account.expiredAt) > this.now())
    if (!active) {
      throw new ApiError(403, account.status === 'Active' ? 'This VPN account has expired.' : 'This VPN account is disabled.')
    }
    return {
      id: account.id,
      username: account.username,
      status: account.status,
      isActive: true,
      expiredAt: account.expiredAt,
      createdAt: account.created,
      updatedAt: account.updated,
      password,
      wgIp: account.wgIp,
      wgPrivateKey: account.wgPrivateKey,
      wgPublicKey: account.wgPublicKey
    }
  }

  private commit(token: number, account: PrivateAccount): VpnAccountInfo {
    if (!this.isCurrent(token)) throw this.superseded()
    this.signedOut.set(false)
    this.current = account
    return publicInfo(account)
  }

  async login(username: string, password: string, remember: boolean): Promise<VpnAccountInfo> {
    const token = this.begin()
    try {
      const account = await this.activeAccount(username, password)
      if (!this.isCurrent(token)) throw this.superseded()
      const persisted = remember
        ? await this.credentials.saveIfCurrent(username, password, () => this.isCurrent(token))
        : this.credentials.forgetIfCurrent(() => this.isCurrent(token))
      if (!persisted || !this.isCurrent(token)) throw this.superseded()
      return this.commit(token, account)
    } catch (error) {
      if (!this.isCurrent(token) && !(error instanceof AuthSessionError && error.code === 'SUPERSEDED')) throw this.superseded()
      throw translate(error)
    }
  }

  async getRememberedLogin(): Promise<{ username: string } | null> {
    try {
      return await this.credentials.rememberedLogin()
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        if (error.code === 'CREDENTIAL_STORE_CORRUPT') this.credentials.forgetIfCurrent(() => true)
        return null
      }
      throw error
    }
  }

  async loginWithSavedCredentials(): Promise<VpnAccountInfo> {
    const token = this.begin()
    try {
      const saved = await this.credentials.read()
      if (!this.isCurrent(token)) throw this.superseded()
      if (!saved) throw new AuthSessionError('AUTH', 'No remembered VPN credentials to sign in with.')
      const account = await this.activeAccount(saved.username, saved.password)
      return this.commit(token, account)
    } catch (error) {
      if (!this.isCurrent(token) && !(error instanceof AuthSessionError && error.code === 'SUPERSEDED')) throw this.superseded()
      if (this.isCurrent(token) && error instanceof ApiError && error.status === 401) this.credentials.forgetIfCurrent(() => this.isCurrent(token))
      throw translate(error)
    }
  }

  async restoreSession(): Promise<VpnAccountInfo | null> {
    const token = this.begin()
    if (this.signedOut.get()) return null
    try {
      const saved = await this.credentials.read()
      if (!this.isCurrent(token)) throw this.superseded()
      if (!saved) return null
      const account = await this.activeAccount(saved.username, saved.password)
      return this.commit(token, account)
    } catch (error) {
      if (!this.isCurrent(token)) throw this.superseded()
      if (error instanceof ApiError && error.status === 401) {
        this.credentials.forgetIfCurrent(() => this.isCurrent(token))
        return null
      }
      if (error instanceof ApiError && error.status === 403) return null
      throw translate(error)
    }
  }

  async refreshAccount(): Promise<VpnAccountInfo> {
    const token = this.generation
    const current = this.current
    if (!current) throw new AuthSessionError('AUTH', 'No signed-in VPN account.')
    try {
      const refreshed = await this.activeAccount(current.username, current.password)
      return this.commit(token, refreshed)
    } catch (error) {
      if (!this.isCurrent(token)) throw this.superseded()
      throw translate(error)
    }
  }

  logout(): void {
    this.begin()
    this.signedOut.set(true)
  }

  forgetCredentials(): void {
    const token = this.begin()
    this.signedOut.set(true)
    this.credentials.forgetIfCurrent(() => this.isCurrent(token))
  }

  currentCredentials(): Credentials | null {
    return this.current ? { username: this.current.username, password: this.current.password } : null
  }

  currentSecrets(): { wgIp: string | null; wgPrivateKey: string | null; wgPublicKey: string | null } | null {
    if (!this.current) return null
    return { wgIp: this.current.wgIp, wgPrivateKey: this.current.wgPrivateKey, wgPublicKey: this.current.wgPublicKey }
  }

  async listServers(): Promise<DesktopServer[]> {
    const token = this.generation
    const current = this.current
    if (!current) throw new AuthSessionError('AUTH', 'No signed-in VPN account.')
    try {
      const servers = await this.api.fetchServers(current.username, current.password)
      if (!this.isCurrent(token)) throw this.superseded()
      return servers
    } catch (error) { throw translate(error) }
  }

  async wireguardInputs(serverId: string): Promise<{ secrets: NonNullable<ReturnType<AuthManager['currentSecrets']>>; peer: WireguardPeerConfig }> {
    const token = this.generation
    const current = this.current
    const secrets = this.currentSecrets()
    if (!current || !secrets) throw new AuthSessionError('AUTH', 'No signed-in VPN account.')
    try {
      const peer = await this.api.fetchWireguardConfig(current.username, current.password, serverId)
      if (!this.isCurrent(token)) throw this.superseded()
      return { secrets, peer }
    } catch (error) { throw translate(error) }
  }
}
