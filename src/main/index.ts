import { app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isAllowedExternalUrl } from './security'
import { daemonRequest } from './daemonClient'
import { HealthMonitor } from './healthMonitor'
import { SettingsStore } from './settingsStore'
import { AutoStartManager, autoStartExecutable } from './autoStart'
import { CredentialStore, type CredentialCrypto } from './credentialStore'
import { assertTrustedIpcSource } from './ipcPolicy'
import { parseLanguage, parseLoginInput } from './ipcValidation'
import { SignedOutStore } from './sessionStore'
import { AuthManager } from './authManager'
import { validateTunnelConfig } from './tunnelConfig'
import { effectiveDns } from '../shared/dns'
import { fetchPublicIp } from './ipInfo'
import { AutoConnect, AutoConnectErrorState } from './autoConnect'
import { createUplinkSource } from './network'
import { AppTray, hasTrayHost } from './tray'
import { desktopText } from './trayModel'
import { QuitController } from './lifecycle'

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const development = !app.isPackaged
    const policy = development
      ? "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: http://localhost:*; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

function registerIpcHandlers(health: HealthMonitor, settings: SettingsStore, autoStart: AutoStartManager, auth: AuthManager, trustedWebContents: ReadonlySet<number>, desktop: {
  quit(): Promise<void>; setLanguage(language: 'el' | 'en'): void; isQuitting(): boolean
}) {
  const assertAvailable = (): void => {
    if (desktop.isQuitting()) throw new Error('K1VPN is closing. Please wait.')
  }
  const autoErrors = new AutoConnectErrorState((error) => broadcast('vpn:autoConnectError:changed', error))
  const connectAndRemember = async (serverId: string): Promise<unknown> => {
    assertAvailable()
    const result = await health.operation(
      'connecting',
      async () => {
        const { secrets, peer } = await auth.wireguardInputs(serverId)
        const config = validateTunnelConfig(secrets, peer, effectiveDns(settings.get().dns, peer.dns))
        const { killSwitch, allowLocalNetwork } = settings.get()
        const protection = { killSwitch, allowLocalNetwork: killSwitch && allowLocalNetwork === true }
        return daemonRequest('connect', { operationId: randomUUID(), serverId, config, protection })
      },
      serverId
    )
    const username = auth.currentCredentials()?.username
    if (username) await settings.rememberServer(serverId, username).catch(() => undefined)
    return result
  }
  const autoConnect = new AutoConnect({
    server: (username) => settings.automaticServer(username),
    isCurrent: (username) => auth.currentCredentials()?.username === username,
    connect: async (serverId, stillCurrent) => {
      const status = (await daemonRequest('status')) as { state?: string }
      if (status.state !== 'disconnected' || !stillCurrent()) return
      return connectAndRemember(serverId)
    },
    error: (error) => autoErrors.report(error)
  })
  const startAutoConnect = (account: { username: string } | null): void => {
    if (account) void autoConnect.start(account.username)
  }

  const handle = (channel: string, handler: IpcHandler): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedIpcSource(event, trustedWebContents)
      return handler(event, ...args)
    })
  }

  handle('app:quit', () => desktop.quit())
  handle('app:setLanguage', (_event, language: unknown) => { desktop.setLanguage(parseLanguage(language)) })
  handle('updates:get', () => ({ status: 'disabled', current: app.getVersion() }))
  handle('updates:check', () => ({ status: 'disabled', current: app.getVersion() }))
  handle('updates:install', () => ({ status: 'disabled', current: app.getVersion() }))
  handle('settings:get', () => settings.get())
  handle('settings:set', async (_event, key: unknown, value: unknown) => {
    if (key === 'autoConnect' && value === false) autoConnect.cancel()
    if (key !== 'autoStart') return settings.set(key, value)
    if (typeof value !== 'boolean') throw new TypeError('Setting value must be boolean')
    const previous = settings.get().autoStart
    await autoStart.set(value)
    try {
      return await settings.set(key, value)
    } catch (error) {
      await autoStart.set(previous).catch(() => undefined)
      throw error
    }
  })
  handle('settings:setDns', (_event, mode: unknown, custom: unknown) => settings.setDns(mode, custom))
  handle('vpn:health', () => health.get())
  handle('vpn:health:refresh', () => health.refresh())
  handle('vpn:health:allowLookup', () => health.allowAddressLookup())
  handle('vpn:listServers', () => auth.listServers())
  handle('vpn:ping', () => daemonRequest('ping'))
  handle('vpn:status', () => daemonRequest('status'))
  handle('vpn:connect', async (_event, serverId: unknown) => {
    if (typeof serverId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(serverId)) {
      throw new TypeError('Invalid server ID')
    }
    autoConnect.cancel()
    return connectAndRemember(serverId)
  })
  const disconnect = () => {
    assertAvailable()
    autoConnect.cancel()
    return health.operation('disconnecting', () => daemonRequest('disconnect'))
  }
  handle('vpn:disconnect', disconnect)
  handle('vpn:restartService', () => { assertAvailable(); return health.operation('disconnecting', () => daemonRequest('recover')) })
  handle('vpn:publicIp', () => fetchPublicIp())
  handle('vpn:autoConnectError', () => autoErrors.get())
  handle('vpn:autoConnectError:acknowledge', (_event, id: unknown) => autoErrors.acknowledge(id))
  handle('auth:restoreSession', async () => {
    const account = await auth.restoreSession()
    if (account) health.allowAddressLookup()
    health.invalidate('account')
    startAutoConnect(account)
    return account
  })
  handle('auth:getRememberedLogin', () => auth.getRememberedLogin())
  handle('auth:forgetCredentials', async () => { await disconnect(); health.invalidate('account'); return auth.forgetCredentials() })
  handle('auth:logout', async () => { await disconnect(); health.invalidate('account'); return auth.logout() })
  handle('auth:login', (_event, value: unknown) => {
    const input = parseLoginInput(value)
    return auth.login(input.username, input.password, input.remember).then((account) => { health.invalidate('account'); startAutoConnect(account); return account })
  })
  handle('auth:loginWithSavedCredentials', async () => { const account = await auth.loginWithSavedCredentials(); health.invalidate('account'); startAutoConnect(account); return account })
  handle('auth:refreshAccount', () => auth.refreshAccount())
  return {
    cancelAutoConnect: () => autoConnect.cancel(),
    disconnect,
    connectLast: async (): Promise<boolean> => {
      assertAvailable()
      const username = auth.currentCredentials()?.username
      const serverId = username ? settings.lastServerFor(username) : null
      if (!serverId) return false
      autoConnect.cancel()
      await connectAndRemember(serverId)
      return true
    }
  }
}

function createWindow(trustedWebContents: Set<number>): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'K1VPN',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icons/k1vpn.png')
      : join(app.getAppPath(), 'packaging/icons/k1vpn.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  const webContentsId = window.webContents.id
  trustedWebContents.add(webContentsId)
  window.once('closed', () => trustedWebContents.delete(webContentsId))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  window.once('ready-to-show', () => window.show())

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

if (process.platform === 'linux') {
  app.setDesktopName(process.env.SNAP_NAME === 'k1vpn' ? 'k1vpn_k1vpn.desktop' : 'k1vpn.desktop')
  app.commandLine.appendSwitch('class', 'k1vpn')
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let restoreWindow = (): void => {}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    restoreWindow()
  })

  app.whenReady().then(async () => {
    installContentSecurityPolicy()
    const settings = await SettingsStore.open(join(app.getPath('userData'), 'preferences.json'))
    const credentialCrypto: CredentialCrypto = {
      isAvailable: async () => {
        if (process.platform !== 'linux' || !(await safeStorage.isAsyncEncryptionAvailable())) return false
        return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
      },
      encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
      decrypt: async (ciphertext) => {
        const result = await safeStorage.decryptStringAsync(ciphertext)
        return { plaintext: result.result, shouldReEncrypt: result.shouldReEncrypt }
      }
    }
    const credentials = new CredentialStore(join(app.getPath('userData'), 'credentials.dat'), credentialCrypto)
    const signedOut = new SignedOutStore(join(app.getPath('userData'), 'signed-out'))
    const auth = new AuthManager(credentials, signedOut)
    const autoStart = new AutoStartManager(
      join(app.getPath('appData'), 'autostart', 'com.k1vpn.linux.desktop'),
      autoStartExecutable(app.getPath('exe'))
    )
    // Kept in sync in the background; the window does not wait for it.
    void autoStart.set(settings.get().autoStart).catch(() => settings.set('autoStart', false)).catch(() => undefined)
    const health = new HealthMonitor({
      status: () => daemonRequest('status'),
      probe: (signal) => fetchPublicIp(signal),
      // Anything the service does not clearly report is "the check could not be made", never
      // evidence that the tunnel failed.
      verify: async () => {
        try {
          const outcome = ((await daemonRequest('verify')) as { outcome?: unknown } | null)?.outcome
          return outcome === 'verified' || outcome === 'inconclusive' ? outcome : 'error'
        } catch {
          return 'error'
        }
      },
      uplink: createUplinkSource(),
      // Nothing is looked up before the VPN notice is accepted or a saved account is restored.
      addressLookupAllowed: false
    })
    let tray: AppTray | undefined
    let language: 'el' | 'en' = app.getLocale().startsWith('el') ? 'el' : 'en'
    const text = () => desktopText[language]
    // Without a parent, Wayland may place a message box behind the window,
    // leaving its pending promise (and any quit waiting on it) unanswerable.
    const messageBox = (options: Electron.MessageBoxOptions) => {
      restoreWindow()
      const window = BrowserWindow.getAllWindows()[0]
      return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
    }
    const showError = (error: unknown): void => {
      // Desktop actions (tray, quit) have no IPC handler to log their failure.
      console.error('K1VPN desktop action failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error')
      void messageBox({ type: 'error', title: text().error, message: text().errorMessage })
    }
    health.subscribe((snapshot) => {
      broadcast('vpn:health:changed', snapshot)
      tray?.update(snapshot)
    })
    powerMonitor.on('suspend', () => health.invalidate('suspend'))
    powerMonitor.on('resume', () => health.invalidate('resume'))
    const trustedWebContents = new Set<number>()
    const quit = new QuitController({
      confirm: async () => {
        actions.cancelAutoConnect()
        const result = await messageBox({
          type: 'question', title: text().quitTitle, message: text().quitMessage,
          buttons: [text().cancel, text().quit.replace(/…$/, '')], defaultId: 0, cancelId: 0,
          noLink: true
        })
        return result.response === 1
      },
      disconnect: () => health.operation('quitting', () => daemonRequest('disconnect')),
      status: () => daemonRequest('status'),
      quit: () => app.quit()
    })
    const actions = registerIpcHandlers(health, settings, autoStart, auth, trustedWebContents, {
      quit: () => quit.request(),
      isQuitting: () => quit.busy || quit.allowed,
      setLanguage: (next) => { language = next; tray?.setLanguage(next) }
    })
    const openWindow = (): void => {
      const window = createWindow(trustedWebContents)
      let hiding = false
      window.on('close', (event) => {
        if (quit.allowed) return
        event.preventDefault()
        if (hiding || quit.busy) return
        hiding = true
        void (async () => {
          const marker = join(app.getPath('userData'), 'window-close-notice-shown')
          if (!existsSync(marker)) {
            const result = await dialog.showMessageBox(window, {
              type: 'info', title: text().hiddenTitle, message: text().hiddenMessage,
              checkboxLabel: text().hiddenAgain, checkboxChecked: true
            })
            if (result.checkboxChecked) await writeFile(marker, '1', { mode: 0o600 }).catch(() => undefined)
          }
          if (window.isDestroyed()) return
          if (tray && await hasTrayHost()) window.hide()
          else window.minimize()
        })().catch(showError).finally(() => { hiding = false })
      })
      window.on('show', () => health.setWindowVisible(true))
      window.on('restore', () => health.setWindowVisible(true))
      window.on('hide', () => health.setWindowVisible(false))
      window.on('minimize', () => health.setWindowVisible(false))
      window.once('closed', () => health.setWindowVisible(false))
    }
    restoreWindow = () => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) { openWindow(); return }
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    // The window opens first; the status icon follows once the desktop has
    // confirmed it can host one.
    openWindow()
    health.start()
    void hasTrayHost().then((available) => {
      if (!available || quit.allowed) return
      try {
        tray = new AppTray(app.isPackaged ? join(process.resourcesPath, 'icons/k1vpn.png') : join(app.getAppPath(), 'packaging/icons/k1vpn.png'), health.get(), {
          open: () => restoreWindow(),
          connect: async () => {
            if (!await actions.connectLast()) {
              await messageBox({ type: 'info', message: text().chooseServer })
            }
          },
          disconnect: actions.disconnect, quit: () => quit.request(), error: showError
        })
        tray.setLanguage(language)
        tray.update(health.get())
      } catch { /* Without a tray host, keep the window accessible in the taskbar. */ }
    })
    // Logout, shutdown and snapd's refresh send SIGTERM. A confirmation dialog
    // nobody may answer would block them, so the app closes at once.
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => quit.exitNow())
    app.on('before-quit', (event) => {
      if (quit.allowed) return
      event.preventDefault()
      void quit.request().catch(showError)
    })
    app.once('will-quit', () => { health.stop(); tray?.destroy() })

    app.on('activate', () => {
      restoreWindow()
    })
  })

  // The status icon and health monitor stay alive independently of the window.
  app.on('window-all-closed', () => {})
}
