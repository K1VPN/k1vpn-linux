import { CHECKING_SNAPSHOT, isHealthSnapshot, type HealthSnapshot } from '../../../shared/connectionHealth'
import type { AutoConnectErrorInfo } from '../../../shared/contracts'
export type { AutoConnectErrorInfo }

function parseAutoConnectError(value: unknown): AutoConnectErrorInfo | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return typeof data.id === 'number' && typeof data.code === 'string' && typeof data.message === 'string'
    ? { id: data.id, code: data.code, message: data.message }
    : null
}

export interface HealthStore {
  getSnapshot(): HealthSnapshot
  subscribe(listener: () => void): () => void
  start(): void
  stop(): void
  toggle(serverId: string): Promise<void>
  recover(action: 'release' | 'restart'): Promise<void>
  allowAddressLookup(): void
  getAutoConnectError(): AutoConnectErrorInfo | null
  subscribeAutoConnectError(listener: () => void): () => void
  acknowledgeAutoConnectError(id: number): Promise<void>
}

export class DesktopHealthStore implements HealthStore {
  private autoConnectError: AutoConnectErrorInfo | null = null
  private errorListeners = new Set<() => void>()
  private unsubscribeError?: () => void
  private errorRevision = 0
  private lifecycle = 0
  private snapshot = CHECKING_SNAPSHOT
  private listeners = new Set<() => void>()
  private unsubscribe?: () => void

  constructor(private api: Window['api']['vpn']) {}

  getSnapshot = (): HealthSnapshot => this.snapshot
  getAutoConnectError = (): AutoConnectErrorInfo | null => this.autoConnectError

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeAutoConnectError = (listener: () => void): (() => void) => {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  private accept(value: unknown): void {
    if (!isHealthSnapshot(value) || value.revision <= this.snapshot.revision) return
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }

  private setAutoConnectError(value: unknown): void {
    this.autoConnectError = parseAutoConnectError(value)
    this.errorRevision += 1
    for (const listener of this.errorListeners) listener()
  }

  async acknowledgeAutoConnectError(id: number): Promise<void> {
    await this.api.autoConnectError.acknowledge(id)
    if (this.autoConnectError?.id === id) this.setAutoConnectError(null)
  }

  start(): void {
    if (this.unsubscribe) return
    const lifecycle = ++this.lifecycle
    const errorRevision = this.errorRevision
    this.unsubscribeError = this.api.autoConnectError.subscribe((value) => {
      if (this.lifecycle === lifecycle) this.setAutoConnectError(value)
    })
    void this.api.autoConnectError.get().then((value) => {
      // A newer pushed error must not be erased by the initial snapshot arriving late.
      if (this.lifecycle === lifecycle && this.errorRevision === errorRevision) {
        this.setAutoConnectError(value)
      }
    }).catch(() => {})
    this.unsubscribe = this.api.health.subscribe((value) => {
      if (this.lifecycle === lifecycle) this.accept(value)
    })
    void this.api.health.get().then((value) => {
      if (this.lifecycle === lifecycle) this.accept(value)
    }).catch(() => {})
  }

  stop(): void {
    this.lifecycle += 1
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeError?.()
    this.unsubscribeError = undefined
  }

  allowAddressLookup(): void {
    void this.api.health.allowLookup().catch(() => {})
  }

  async toggle(serverId: string): Promise<void> {
    if (this.snapshot.operation !== null) return
    if (this.snapshot.tunnelUp) await this.api.disconnect()
    else if (this.snapshot.display === 'disconnected') await this.api.connect(serverId)
  }

  async recover(action: 'release' | 'restart'): Promise<void> {
    try {
      if (action === 'release') await this.api.disconnect()
      else await this.api.restartService()
    } catch (error) {
      await this.api.health.refresh().catch(() => {})
      throw error
    }
    await this.api.health.refresh()
  }
}
