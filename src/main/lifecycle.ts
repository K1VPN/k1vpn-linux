/** All explicit exit paths share one confirmation and one verified disconnect. */
export class QuitController {
  private pending?: Promise<void>
  allowed = false
  get busy(): boolean { return this.pending !== undefined }

  constructor(private readonly deps: {
    confirm(): Promise<boolean>
    disconnect(): Promise<unknown>
    status(): Promise<unknown>
    quit(): void
  }) {}

  /** The session or snapd is ending the app: no dialog, no disconnect. The service keeps the tunnel. */
  exitNow(): void {
    this.allowed = true
    this.deps.quit()
  }

  request(): Promise<void> {
    if (this.allowed) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = this.run().finally(() => { this.pending = undefined })
    return this.pending
  }

  private async run(): Promise<void> {
    if (!await this.deps.confirm()) return
    await this.deps.disconnect()
    const status = await this.deps.status() as { state?: unknown; recovery_required?: unknown } | null
    if (status?.state !== 'disconnected' || status.recovery_required !== false) {
      throw new Error('VPN disconnection could not be confirmed.')
    }
    this.allowed = true
    this.deps.quit()
  }
}
