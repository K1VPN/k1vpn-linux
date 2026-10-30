import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { execFile } from 'node:child_process'
import type { HealthSnapshot } from '../shared/connectionHealth'
import { desktopText, gdbusPath, trayActions, trayState, withTrayPixmap } from './trayModel'

/** Hide the window only when the desktop actually provides a status-icon host. */
export function hasTrayHost(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(gdbusPath(), [
      'call', '--session', '--dest', 'org.freedesktop.DBus',
      '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'
    ], { timeout: 2000, maxBuffer: 1024 }, (error, stdout) => {
      resolve(!error && stdout.trim() === '(true,)')
    })
  })
}

export class AppTray {
  private readonly tray: Tray
  private readonly icons = new Map<string, NativeImage>()
  private language: 'el' | 'en' = 'en'
  private snapshot: HealthSnapshot
  private color: ReturnType<typeof trayState>

  constructor(iconPath: string, initial: HealthSnapshot, private readonly actions: {
    open(): void; connect(): Promise<unknown>; disconnect(): Promise<unknown>
    quit(): Promise<void>; error(error: unknown): void
  }) {
    const base = nativeImage.createFromPath(iconPath).resize({ width: 64, height: 64 })
    if (base.isEmpty()) throw new Error('Missing K1VPN tray icon')
    for (const [color, rgb] of Object.entries({ green: [67, 215, 142], red: [245, 75, 85], amber: [255, 185, 65] })) {
      const pixels = Buffer.from(base.toBitmap())
      for (let y = 32; y < 64; y++) for (let x = 32; x < 64; x++) {
        const distance = Math.hypot(x - 48, y - 48)
        if (distance > 15) continue
        const mark = color === 'green'
          ? (x >= 40 && x <= 46 && Math.abs(y - x - 6) <= 1) || (x > 46 && x <= 56 && Math.abs(y + x - 98) <= 1)
          : color === 'red' ? Math.abs(y - x) <= 1 : y >= 47 && y <= 49
        const [r, g, b] = distance > 12 || (mark && x >= 40 && x <= 56) ? [11, 17, 29] : rgb
        const offset = (y * 64 + x) * 4
        pixels[offset] = b; pixels[offset + 1] = g; pixels[offset + 2] = r; pixels[offset + 3] = 255
      }
      this.icons.set(color, nativeImage.createFromBitmap(pixels, { width: 64, height: 64 }).resize({ width: 32, height: 32 }))
    }
    this.snapshot = initial
    this.color = trayState(initial)
    this.tray = withTrayPixmap(() => new Tray(this.icons.get(this.color)!))
    this.tray.on('click', actions.open)
    this.tray.on('double-click', actions.open)
    this.render()
  }

  update(snapshot: HealthSnapshot): void { this.snapshot = snapshot; this.render() }
  setLanguage(language: 'el' | 'en'): void { this.language = language; this.render() }
  destroy(): void { this.tray.destroy() }

  private render(): void {
    const text = desktopText[this.language]
    const snapshot = this.snapshot
    const state = snapshot.operation === 'quitting' ? text.quitting : text[snapshot.display]
    const allowed = trayActions(snapshot)
    const run = (action: () => Promise<unknown>): void => { void action().catch(this.actions.error) }
    const runNetworkAction = (action: () => Promise<unknown>): void => {
      // GNOME supplies a startup/activation token for menu selections too.
      // Activate the details window before mutating the VPN so Chromium uses
      // that token and the shell can finish its startup feedback.
      this.actions.open()
      run(action)
    }
    const color = trayState(snapshot)
    // IP and language changes do not require a new icon publication.
    if (color !== this.color) {
      this.tray.setImage(this.icons.get(color)!)
      this.color = color
    }
    this.tray.setToolTip(`K1VPN — ${state}`)
    this.tray.setContextMenu(Menu.buildFromTemplate([
      // Native Linux menu backgrounds belong to the desktop theme. Use a
      // colored status marker and normal text; these rows open the details.
      { label: `${{ green: '🟢', red: '🔴', amber: '🟠' }[color]} ${state}`, click: this.actions.open },
      { label: `IP: ${snapshot.publicIp?.ip ?? (snapshot.ipState === 'checking' ? '…' : '—')}`, click: this.actions.open },
      { type: 'separator' },
      { label: text.open, click: this.actions.open },
      { label: text.connect, enabled: allowed.connect, click: () => runNetworkAction(this.actions.connect) },
      { label: text.disconnect, enabled: allowed.disconnect, click: () => runNetworkAction(this.actions.disconnect) },
      { type: 'separator' },
      { label: text.quit, enabled: snapshot.operation === null, click: () => run(this.actions.quit) }
    ]))
  }
}
