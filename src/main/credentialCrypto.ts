import { CredentialStoreError, type CredentialCrypto } from './credentialStore'

export const SECRET_PORTAL_FEATURES = 'DbusSecretPortal,SecretPortalKeyProviderUseForEncryption'

interface SafeStoragePort {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plaintext: string): Promise<Buffer>
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

function unavailable(): CredentialStoreError {
  return new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'Secure credential storage is unavailable. Unlock your desktop keyring and try again.')
}

function secure(ciphertext: Buffer): boolean {
  // Electron 45 / Chromium: v12 = Secret portal, v11 = desktop keyring.
  // v10 uses a public, fixed key. Availability alone also accepts that fallback.
  const tag = ciphertext.subarray(0, 3).toString('ascii')
  return ciphertext.length > 3 && (tag === 'v11' || tag === 'v12')
}

export function createCredentialCrypto(storage: SafeStoragePort): CredentialCrypto {
  return {
    async isAvailable() {
      try {
        if (!(await storage.isAsyncEncryptionAvailable())) return false
        return secure(await storage.encryptStringAsync('K1VPN secure storage probe'))
      } catch { return false }
    },
    async encrypt(plaintext) {
      try {
        const ciphertext = await storage.encryptStringAsync(plaintext)
        if (!secure(ciphertext)) throw unavailable()
        return ciphertext
      } catch {
        throw unavailable()
      }
    },
    async decrypt(ciphertext) {
      if (!secure(ciphertext)) throw unavailable()
      try {
        const result = await storage.decryptStringAsync(ciphertext)
        return { plaintext: result.result, shouldReEncrypt: result.shouldReEncrypt }
      } catch {
        // A locked/missing provider is not proof of corruption. Preserve the
        // saved file so a later launch with the keyring available can retry.
        throw unavailable()
      }
    }
  }
}
