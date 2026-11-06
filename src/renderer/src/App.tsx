import { useCallback, useEffect, useState } from 'react'
import { Screen, VpnAccount } from './types'
import { LanguageProvider } from './i18n/LanguageContext'
import LoginScreen from './screens/LoginScreen'
import VpnNoticeScreen from './screens/VpnNoticeScreen'
import ConnectScreen from './screens/ConnectScreen'
import MenuScreen from './screens/MenuScreen'
import AccountScreen from './screens/AccountScreen'
import SettingsScreen from './screens/SettingsScreen'
import DnsScreen from './screens/DnsScreen'
import AboutScreen from './screens/AboutScreen'
import './assets/main.css'
import titlebarIconUrl from './assets/branding/k1vpn-favicon.svg'
import { Brand } from './components/Brand'
import { getCapabilities } from './platform/capabilities'
import { useLanguage } from './i18n/useLanguage'
import { RecoveryGate } from './components/RecoveryGate'
import { getHealthStore } from './lib/useHealth'
import { clearServerList, readServerList } from './lib/serverCache'
import { connectPreferences } from './lib/connectPreferences'

/** Runs the one connection-state store for as long as the app lives, whatever screen is showing. */
function HealthRunner({ children }: { children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const store = getHealthStore()
    store.start()
    return () => {
      store.stop()
    }
  }, [])
  return <>{children}</>
}

function App(): React.JSX.Element {
  const capabilities = getCapabilities()
  return (
    <LanguageProvider>
      {capabilities.customTitleBar && (
        <>
          <div className="titlebar-drag">
            <img className="titlebar-icon" src={titlebarIconUrl} alt="" />
            K1VPN
          </div>
        </>
      )}
      {(capabilities.customTitleBar || capabilities.systemVpnProtection) && (
        <div
          className={`titlebar-separator${capabilities.customTitleBar ? '' : ' titlebar-separator--native'}`}
          aria-hidden="true"
        />
      )}
      <HealthRunner>
        <RecoveryGate>
          <Screens />
        </RecoveryGate>
      </HealthRunner>
    </LanguageProvider>
  )
}

function Screens(): React.JSX.Element {
  const { t } = useLanguage()
  const [screen, setScreen] = useState<Screen>('loading')
  const [account, setAccount] = useState<VpnAccount | null>(null)

  // Remember native/menu/automatic connections too, even while the connect screen is closed.
  // A disconnected snapshot has no server ID and must never erase the user's last choice.
  const accountUsername = account?.username
  useEffect(() => {
    if (!accountUsername) return
    const store = getHealthStore()
    const rememberConnectedServer = (): void => {
      connectPreferences.rememberConnection(accountUsername, store.getSnapshot())
    }
    const unsubscribe = store.subscribe(rememberConnectedServer)
    rememberConnectedServer()
    return unsubscribe
  }, [accountUsername])

  // The VPN password lives only in the main process (see authClient.ts) —
  // a restored login on launch never passes it through the renderer.
  useEffect(() => {
    let cancelled = false
    window.api.auth
      .restoreSession()
      .then((restored) => {
        if (cancelled) return
        if (restored) {
          // A saved account means the notice was accepted at sign-in: lookups may run.
          getHealthStore().allowAddressLookup()
          setAccount(restored)
          setScreen('connect')
        } else {
          setScreen('notice')
        }
      })
      .catch((e) => {
        // Couldn't verify possibly-still-valid remembered credentials right
        // now (e.g. offline at launch) — authClient.ts deliberately did not
        // discard them. Fall back to the login screen for this launch;
        // trying again just means relaunching once back online.
        console.error('restoreSession failed:', e)
        if (!cancelled) setScreen('notice')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleLoginSuccess(acc: VpnAccount): void {
    setAccount(acc)
    setScreen('connect')
  }

  async function handleLogout(): Promise<void> {
    await window.api.auth.logout()
    clearServerList()
    setAccount(null)
    setScreen('notice')
  }

  const handleAccountRefresh = useCallback(async (): Promise<VpnAccount> => {
    const refreshed = await window.api.auth.refreshAccount()
    setAccount(refreshed)
    return refreshed
  }, [])

  switch (screen) {
    case 'loading':
      return (
        <div className="screen login-screen">
          <Brand />
          <p className="login-subtitle" role="status">
            {t('startingApp')}
          </p>
        </div>
      )
    // Every way into a manual sign-in passes through the VPN notice first (see VpnNoticeScreen).
    case 'notice':
      return (
        <VpnNoticeScreen
          onAccept={() => {
            // Until now nothing has been sent to look up the public address.
            getHealthStore().allowAddressLookup()
            setScreen('login')
          }}
        />
      )
    case 'login':
      return <LoginScreen onSuccess={handleLoginSuccess} />
    case 'connect':
      return <ConnectScreen account={account!} onMenu={() => setScreen('menu')} />
    case 'menu':
      return (
        <MenuScreen
          onBack={() => setScreen('connect')}
          onAccount={() => setScreen('account')}
          onSettings={() => setScreen('settings')}
          onAbout={() => setScreen('about')}
        />
      )
    case 'account':
      return (
        <AccountScreen
          account={account!}
          onBack={() => setScreen('menu')}
          onLogout={handleLogout}
          onRefresh={handleAccountRefresh}
        />
      )
    case 'settings':
      return <SettingsScreen onBack={() => setScreen('menu')} onDns={() => setScreen('dns')} />
    case 'dns':
      return <DnsScreen onBack={() => setScreen('settings')} />
    case 'about':
      return (
        <AboutScreen
          onBack={() => setScreen('menu')}
          serverCount={account ? readServerList(account.username)?.list.length : undefined}
        />
      )
  }
}

export default App
