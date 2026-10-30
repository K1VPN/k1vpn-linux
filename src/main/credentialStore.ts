import { readFile } from 'node:fs/promises'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CredentialCrypto {
  isAvailable(): Promise<boolean>
  encrypt(plaintext: string): Promise<Buffer>
  decrypt(ciphertext: Buffer): Promise<{ plaintext: string; shouldReEncrypt: boolean }>
}

export interface Credentials {
  username: string
  password: string
}

interface CredentialFile {
  version: 1
  username: string
  ciphertext: string
}

export class CredentialStoreError extends Error {
  constructor(readonly code: 'CREDENTIAL_STORE_UNAVAILABLE' | 'CREDENTIAL_STORE_CORRUPT', message: string) {
    super(message)
    this.name = 'CredentialStoreError'
  }
}

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\0\r\n]/.test(value)
}

function parseFile(raw: string): CredentialFile {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Saved credentials are corrupt.') }
  if (!value || typeof value !== 'object') throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Saved credentials are corrupt.')
  const file = value as Partial<CredentialFile>
  if (file.version !== 1 || !validUsername(file.username) || typeof file.ciphertext !== 'string' || file.ciphertext.length === 0 || file.ciphertext.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.ciphertext)) {
    throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Saved credentials are corrupt.')
  }
  const decoded = Buffer.from(file.ciphertext, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== file.ciphertext) {
    throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Saved credentials are corrupt.')
  }
  return file as CredentialFile
}

function validateCredentials(username: string, password: string): void {
  if (!validUsername(username)) throw new TypeError('Invalid username')
  if (password.length === 0 || password.length > 4_096 || password.includes('\0')) throw new TypeError('Invalid password')
}

let sequence = 0

export class CredentialStore {
  constructor(private readonly path: string, private readonly crypto: CredentialCrypto) {}

  async save(username: string, password: string): Promise<void> {
    await this.saveIfCurrent(username, password, () => true)
  }

  async saveIfCurrent(username: string, password: string, isCurrent: () => boolean): Promise<boolean> {
    validateCredentials(username, password)
    if (!(await this.crypto.isAvailable())) {
      throw new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'Secure credential storage is unavailable. Configure Secret Service or KWallet and try again.')
    }
    const encrypted = await this.crypto.encrypt(password)
    if (!isCurrent()) return false
    const file: CredentialFile = { version: 1, username, ciphertext: encrypted.toString('base64') }
    this.write(file)
    return true
  }

  async read(): Promise<Credentials | null> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
    if (!(await this.crypto.isAvailable())) {
      throw new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'Secure credential storage is unavailable. Configure Secret Service or KWallet and try again.')
    }
    const file = parseFile(raw)
    try {
      const decrypted = await this.crypto.decrypt(Buffer.from(file.ciphertext, 'base64'))
      validateCredentials(file.username, decrypted.plaintext)
      if (decrypted.shouldReEncrypt) {
        await this.saveIfCurrent(file.username, decrypted.plaintext, () => {
          try { return readFileSync(this.path, 'utf8') === raw } catch { return false }
        })
      }
      return { username: file.username, password: decrypted.plaintext }
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error
      throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Saved credentials could not be decrypted.')
    }
  }

  async rememberedLogin(): Promise<{ username: string } | null> {
    const credentials = await this.read()
    return credentials ? { username: credentials.username } : null
  }

  async forget(): Promise<void> {
    this.forgetIfCurrent(() => true)
  }

  forgetIfCurrent(isCurrent: () => boolean): boolean {
    if (!isCurrent()) return false
    try { unlinkSync(this.path) } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
    return true
  }

  private write(file: CredentialFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${++sequence}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify(file)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      renameSync(temporary, this.path)
      chmodSync(this.path, 0o600)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* best-effort cleanup of our exact temporary path */ }
      throw error
    }
  }
}
