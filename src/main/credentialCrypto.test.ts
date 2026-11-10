import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCredentialCrypto } from './credentialCrypto'
import { CredentialStore } from './credentialStore'

function setup(tag: string) {
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (text: string) => Buffer.from(tag + text)),
    decryptStringAsync: vi.fn(async () => ({ result: 'password', shouldReEncrypt: false }))
  }
  return { storage, crypto: createCredentialCrypto(storage) }
}

describe('Linux credential encryption', () => {
  it.each(['v11', 'v12'])('accepts %s without consulting the synchronous backend', async (tag) => {
    const { crypto } = setup(tag)
    expect(await crypto.isAvailable()).toBe(true)
    expect(await crypto.encrypt('password')).toEqual(Buffer.from(tag + 'password'))
  })

  it.each(['v10', 'v99', ''])('rejects fallback or unknown format %s even when Electron reports availability', async (tag) => {
    const { crypto } = setup(tag)
    expect(await crypto.isAvailable()).toBe(false)
    await expect(crypto.encrypt('password')).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' })
  })

  it('checks each encryption even if the availability probe succeeded', async () => {
    const { storage, crypto } = setup('v12')
    expect(await crypto.isAvailable()).toBe(true)
    storage.encryptStringAsync.mockResolvedValue(Buffer.from('v10unsafe'))
    await expect(crypto.encrypt('password')).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' })
  })

  it('reports provider encryption failure as unavailable rather than corrupt data', async () => {
    const { storage, crypto } = setup('v12')
    storage.encryptStringAsync.mockRejectedValue(new Error('Provider locked'))
    await expect(crypto.encrypt('password')).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' })
  })

  it('preserves existing credentials when decryption is temporarily unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'k1vpn-crypto-'))
    try {
      const { storage, crypto } = setup('v11')
      const path = join(directory, 'credentials.dat')
      const store = new CredentialStore(path, crypto)
      await store.save('user', 'password')
      const original = await readFile(path, 'utf8')
      storage.decryptStringAsync.mockRejectedValue(new Error('temporarily unavailable'))
      await expect(store.read()).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' })
      expect(await readFile(path, 'utf8')).toBe(original)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('migrates keyring ciphertext when Electron requests portal re-encryption', async () => {
    const { storage, crypto } = setup('v12')
    storage.decryptStringAsync.mockResolvedValue({ result: 'password', shouldReEncrypt: true })
    expect(await crypto.decrypt(Buffer.from('v11old ciphertext'))).toEqual({ plaintext: 'password', shouldReEncrypt: true })
    expect((await crypto.encrypt('password')).subarray(0, 3).toString()).toBe('v12')
  })
})
