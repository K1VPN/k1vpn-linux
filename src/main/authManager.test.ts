import { describe, expect, it, vi } from 'vitest'
import { ApiError, type DesktopServer, type VpnAccount, type WireguardPeerConfig } from './apiClient'
import { AuthManager, type AuthApi, type CredentialPort, type SignedOutPort } from './authManager'

const account: VpnAccount = { id: 1, username: 'user', status: 'Active', wgIp: '10.0.0.2', wgPrivateKey: 'private', wgPublicKey: 'public', expiredAt: null, created: 'created', updated: 'updated' }

function setup(overrides: Partial<AuthApi> = {}): { manager: AuthManager; credentials: CredentialPort & { value: { username: string; password: string } | null }; signedOut: SignedOutPort & { value: boolean }; api: AuthApi } {
  const credentials: CredentialPort & { value: { username: string; password: string } | null } = {
    value: null,
    async read() { return this.value },
    async rememberedLogin() { return this.value ? { username: this.value.username } : null },
    async saveIfCurrent(username, password, guard) { if (!guard()) return false; this.value = { username, password }; return true },
    forgetIfCurrent(guard) { if (!guard()) return false; this.value = null; return true }
  }
  const signedOut: SignedOutPort & { value: boolean } = { value: false, get() { return this.value }, set(value) { this.value = value } }
  const api: AuthApi = {
    fetchAccount: vi.fn(async () => account),
    fetchServers: vi.fn(async () => [] as DesktopServer[]),
    fetchWireguardConfig: vi.fn(async () => ({}) as WireguardPeerConfig),
    ...overrides
  }
  return { manager: new AuthManager(credentials, signedOut, api, () => 1_000), credentials, signedOut, api }
}

describe('AuthManager', () => {
  it('returns only public account fields and retains secrets internally', async () => {
    const { manager } = setup()
    const result = await manager.login('user', 'pw-test', false)
    expect(result).toEqual({ id: 1, username: 'user', status: 'Active', isActive: true, expiredAt: null, createdAt: 'created', updatedAt: 'updated' })
    expect(result).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('wgPrivateKey')
    expect(manager.currentCredentials()).toEqual({ username: 'user', password: 'pw-test' })
    expect(manager.currentSecrets()).toEqual({ wgIp: '10.0.0.2', wgPrivateKey: 'private', wgPublicKey: 'public' })
  })

  it('persists only when requested and separates logout from forget', async () => {
    const { manager, credentials, signedOut } = setup()
    await manager.login('user', 'pw-test', true)
    expect(credentials.value).toEqual({ username: 'user', password: 'pw-test' })
    manager.logout()
    expect(credentials.value).not.toBeNull()
    expect(signedOut.value).toBe(true)
    manager.forgetCredentials()
    expect(credentials.value).toBeNull()
  })

  it('rejects disabled and expired accounts as AUTH', async () => {
    for (const inactive of [{ ...account, status: 'Disabled' }, { ...account, expiredAt: '1970-01-01T00:00:00Z' }]) {
      const { manager } = setup({ fetchAccount: async () => inactive })
      await expect(manager.login('user', 'pw-test', false)).rejects.toMatchObject({ code: 'AUTH' })
    }
  })

  it('clears saved credentials only on a definitive 401', async () => {
    for (const status of [401, 403, 503]) {
      const { manager, credentials } = setup({ fetchAccount: async () => { throw new ApiError(status, 'failure') } })
      credentials.value = { username: 'user', password: 'old' }
      await expect(manager.loginWithSavedCredentials()).rejects.toBeTruthy()
      expect(credentials.value === null).toBe(status === 401)
    }
  })

  it('honors explicit sign-out during silent restore', async () => {
    const { manager, credentials } = setup()
    credentials.value = { username: 'user', password: 'saved' }
    manager.logout()
    await expect(manager.restoreSession()).resolves.toBeNull()
  })

  it('fences a slower login behind a newer login', async () => {
    let releaseFirst!: (value: VpnAccount) => void
    const first = new Promise<VpnAccount>((resolve) => { releaseFirst = resolve })
    let calls = 0
    const { manager } = setup({ fetchAccount: async () => ++calls === 1 ? first : { ...account, username: 'new' } })
    const stale = manager.login('old', 'old-password', true)
    const current = manager.login('new', 'new-pw', true)
    await expect(current).resolves.toMatchObject({ username: 'new' })
    releaseFirst({ ...account, username: 'old' })
    await expect(stale).rejects.toMatchObject({ code: 'SUPERSEDED' })
    expect(manager.currentCredentials()).toEqual({ username: 'new', password: 'new-pw' })
  })

  it('does not commit credentials if superseded during keyring encryption', async () => {
    const { manager, credentials } = setup()
    let release!: () => void
    credentials.saveIfCurrent = async function (username, password, guard) {
      await new Promise<void>((resolve) => { release = resolve })
      if (!guard()) return false
      this.value = { username, password }
      return true
    }
    const stale = manager.login('user', 'pw-test', true)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    manager.logout()
    release()
    await expect(stale).rejects.toMatchObject({ code: 'SUPERSEDED' })
    expect(credentials.value).toBeNull()
  })

  it('lists servers only for the current session', async () => {
    const servers: DesktopServer[] = [{ id: '1', countryCode: 'GR', countryName: 'Greece', city: null, label: null, isRecommended: true, isFeatured: true, loadPercent: 10 }]
    const { manager } = setup({ fetchServers: async () => servers })
    await expect(manager.listServers()).rejects.toMatchObject({ code: 'AUTH' })
    await manager.login('user', 'pw-test', false)
    await expect(manager.listServers()).resolves.toEqual(servers)
  })
})
