import { mkdir, readFile, rename, chmod, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DEFAULT_DNS_SETTINGS,
  validateDnsSettings,
  type DnsSettings
} from '../shared/dns'
import type { Settings } from '../shared/contracts'

export type BooleanSetting = 'autoStart' | 'autoConnect' | 'killSwitch' | 'allowLocalNetwork'

const BOOLEAN_SETTINGS: readonly BooleanSetting[] = [
  'autoStart',
  'autoConnect',
  'killSwitch',
  'allowLocalNetwork'
]

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  autoStart: false,
  autoConnect: false,
  killSwitch: false,
  allowLocalNetwork: false,
  dns: DEFAULT_DNS_SETTINGS
}

export interface LastServer { id: string; username: string }

const SERVER_ID = /^[A-Za-z0-9._:-]{1,128}$/

export function parseLastServer(value: unknown): LastServer | null {
  if (!isRecord(value) || !isRecord(value.lastServer)) return null
  const { id, username } = value.lastServer
  if (typeof id !== 'string' || !SERVER_ID.test(id)) return null
  if (typeof username !== 'string' || username.length === 0 || username.length > 256) return null
  return { id, username }
}

function clone(settings: Settings): Settings {
  return { ...settings, dns: { ...settings.dns, custom: [...settings.dns.custom] } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) return clone(DEFAULT_SETTINGS)
  let dns: DnsSettings = { ...DEFAULT_DNS_SETTINGS, custom: [] }
  if (isRecord(value.dns)) {
    try {
      dns = validateDnsSettings(value.dns.mode, value.dns.custom)
    } catch {
      // A corrupt or hand-edited DNS value must never reach the daemon.
    }
  }
  return {
    autoStart: value.autoStart === true,
    autoConnect: value.autoConnect === true,
    killSwitch: value.killSwitch === true,
    allowLocalNetwork: value.allowLocalNetwork === true,
    dns
  }
}

let temporarySequence = 0

async function writeAtomic(path: string, settings: Settings, lastServer: LastServer | null): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${++temporarySequence}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(lastServer ? { ...settings, lastServer } : settings, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export class SettingsStore {
  private writeQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private settings: Settings,
    private lastServer: LastServer | null
  ) {}

  static async open(path: string): Promise<SettingsStore> {
    let value: unknown = null
    try {
      value = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (
        !(
          error instanceof SyntaxError ||
          (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        )
      ) {
        throw error
      }
    }
    return new SettingsStore(path, parseSettings(value), parseLastServer(value))
  }

  get(): Settings {
    return clone(this.settings)
  }

  /** The server to reconnect to at launch, only for the account that chose it. */
  automaticServer(username: string): string | null {
    return this.settings.autoConnect && this.lastServer?.username === username ? this.lastServer.id : null
  }

  lastServerFor(username: string): string | null {
    return this.lastServer?.username === username ? this.lastServer.id : null
  }

  rememberServer(id: string, username: string): Promise<void> {
    const next: LastServer = { id, username }
    const operation = this.writeQueue.then(async () => {
      await writeAtomic(this.path, this.settings, next)
      this.lastServer = next
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }

  async set(key: unknown, value: unknown): Promise<Settings> {
    if (typeof key !== 'string' || !BOOLEAN_SETTINGS.includes(key as BooleanSetting)) {
      throw new TypeError('Invalid settings key')
    }
    if (typeof value !== 'boolean') throw new TypeError('Setting value must be boolean')
    return this.commit((current) => ({ ...current, [key]: value }))
  }

  async setDns(mode: unknown, custom: unknown): Promise<Settings> {
    const dns = validateDnsSettings(mode, custom)
    return this.commit((current) => ({ ...current, dns }))
  }

  private commit(change: (current: Settings) => Settings): Promise<Settings> {
    let result: Settings
    const operation = this.writeQueue.then(async () => {
      const next = change(this.settings)
      await writeAtomic(this.path, next, this.lastServer)
      this.settings = next
      result = this.get()
    })
    // A failed disk write rejects its own caller but must not poison all future
    // updates. State changes only after the durable write succeeds.
    this.writeQueue = operation.catch(() => undefined)
    return operation.then(() => result!)
  }
}
