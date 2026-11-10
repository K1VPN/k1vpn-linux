import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialStore, CredentialStoreError, type CredentialCrypto } from './credentialStore'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function setup(available = true, shouldReEncrypt = false): Promise<{ path: string; store: CredentialStore; crypto: CredentialCrypto }> {
  const directory = await mkdtemp(join(tmpdir(), 'k1vpn-credentials-'))
  directories.push(directory)
  const path = join(directory, 'credentials.dat')
  const crypto: CredentialCrypto = {
    isAvailable: vi.fn(async () => available),
    encrypt: vi.fn(async (plaintext) => Buffer.from(`encrypted:${plaintext}`)),
    decrypt: vi.fn(async (ciphertext) => ({ plaintext: ciphertext.toString().replace('encrypted:', ''), shouldReEncrypt }))
  }
  return { path, store: new CredentialStore(path, crypto), crypto }
}

describe('CredentialStore', () => {
  it('encrypts the password and returns only the username for remembered-login UI', async () => {
    const { path, store } = await setup()
    await store.save('k1_example', 'secret password')
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('secret password')
    expect(await store.rememberedLogin()).toEqual({ username: 'k1_example' })
  })

  it('refuses persistence without a secure OS backend', async () => {
    const { store } = await setup(false)
    await expect(store.save('k1_example', 'secret')).rejects.toEqual(expect.objectContaining({ code: 'CREDENTIAL_STORE_UNAVAILABLE' }))
  })

  it('rejects malformed files and credentials', async () => {
    const { path, store } = await setup()
    await writeFile(path, '{"version":1,"username":"x","ciphertext":"%%%"}')
    await expect(store.read()).rejects.toBeInstanceOf(CredentialStoreError)
    await expect(store.save(' bad ', 'secret')).rejects.toThrow('Invalid username')
    await expect(store.save('good', '')).rejects.toThrow('Invalid password')
  })

  it('re-encrypts data when the OS backend rotates its key', async () => {
    const { store, crypto } = await setup(true, true)
    await store.save('k1_example', 'secret')
    await store.read()
    expect(crypto.encrypt).toHaveBeenCalledTimes(2)
  })

  it('forgets credentials idempotently', async () => {
    const { store } = await setup()
    await store.save('k1_example', 'secret')
    await store.forget()
    await store.forget()
    expect(await store.read()).toBeNull()
  })

  it('preserves usable credentials when key rotation cannot encrypt them again', async () => {
    const { path, store, crypto } = await setup(true, true)
    await store.save('k1_example', 'secret')
    const original = await readFile(path, 'utf8')
    vi.mocked(crypto.encrypt).mockRejectedValue(new Error('Provider became unavailable'))
    expect(await store.read()).toEqual({ username: 'k1_example', password: 'secret' })
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await store.rememberedLogin()).toEqual({ username: 'k1_example' })
  })

  it('preserves usable credentials when the rotated file cannot be written', async () => {
    const { path, store } = await setup(true, true)
    await store.save('k1_example', 'secret')
    const original = await readFile(path, 'utf8')
    vi.spyOn(store, 'saveIfCurrent').mockRejectedValue(new Error('Disk write failed'))
    expect(await store.read()).toEqual({ username: 'k1_example', password: 'secret' })
    expect(await readFile(path, 'utf8')).toBe(original)
  })
})
