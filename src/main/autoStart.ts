import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function quoteDesktopArgument(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Invalid executable path for autostart')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('`', '\\`').replaceAll('$', '\\$')}"`
}

// A Snap revision path stops existing after a refresh; snapd's stable entry
// point does not. snapd starts it through the app's `autostart` declaration.
export function autoStartExecutable(executable: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.SNAP_NAME === 'k1vpn' ? '/snap/bin/k1vpn' : executable
}

export function desktopEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=K1VPN',
    'Icon=k1vpn',
    'StartupWMClass=k1vpn',
    `Exec=${quoteDesktopArgument(executable)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export class AutoStartManager {
  constructor(private readonly path: string, private readonly executable: string) {}

  async set(enabled: boolean): Promise<void> {
    if (!enabled) {
      await unlink(this.path).catch((error: unknown) => {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      })
      return
    }

    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    try {
      await writeFile(temporary, desktopEntry(this.executable), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      })
      await rename(temporary, this.path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
}
