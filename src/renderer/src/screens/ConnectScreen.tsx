import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { VpnAccount, Server } from '../types'
import { useLanguage } from '../i18n/useLanguage'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { CountryFlag } from '../components/CountryFlag'
import { useFavoriteServers } from '../lib/useFavoriteServers'
import { autoConnectErrorReason } from '../lib/autoConnectErrorText'
import { useAfterDelay } from '../lib/useAfterDelay'
import { getHealthStore, useAutoConnectError, useHealth } from '../lib/useHealth'
import {
  loadServerList,
  readServerList,
  resetServerListRetry,
  serverListFetchNeeded
} from '../lib/serverCache'
import { computeVirtualRange, virtualListHeight } from '../lib/virtualRange'
import { AppIcon } from '../components/AppIcon'
import { Brand } from '../components/Brand'
import { availableSelectedServer, connectPreferences } from '../lib/connectPreferences'
import { useConnectPreferences } from '../lib/useConnectPreferences'
import { scheduleServerListRetry, serverListRetryDelay } from '../lib/serverListRetry'

// A 55px button plus the row's two 1px borders, matching the existing compact UI.
// The rendered rows get this exact height; spacers never infer it from CSS.
const SERVER_ROW_HEIGHT = 57
const SERVER_ROW_GAP = 6

interface Props {
  account: VpnAccount
  onMenu: () => void
}

/** How long a proven tunnel may wait for its address before showing "VPN connected". */
const ADDRESS_GRACE_MS = 15_000

export default function ConnectScreen({ account, onMenu }: Props): React.JSX.Element {
  const { t } = useLanguage()
  // The app-level store already has the current state: the first frame is correct, and nothing
  // is asked of anyone when this screen mounts again after a menu.
  const health = useHealth()
  const { display, publicIp, ipState, reason } = health
  const autoConnectError = useAutoConnectError()
  // The list belongs to the signed-in session and survives navigation and network loss.
  const [cachedList] = useState(() => readServerList(account.username))
  const [needsFetch] = useState(() => serverListFetchNeeded(account.username))
  const [servers, setServers] = useState<Server[]>(cachedList?.list ?? [])
  const [serversLoading, setServersLoading] = useState(!cachedList)
  const [serversError, setServersError] = useState('')
  const preferences = useConnectPreferences(account.username)
  const selectedServerId = availableSelectedServer(preferences, servers)
  const tab = preferences.tab
  const [error, setError] = useState('')
  const { isFavorite, toggleFavorite } = useFavoriteServers()

  const isTransitioning = display === 'connecting' || display === 'disconnecting'
  // A tunnel exists (verified or not, with or without Internet behind it): it can be disconnected.
  const isConnected = health.tunnelUp && !isTransitioning
  const isChecking = display === 'checking' || display === 'unknown'
  const isProtected = display === 'protected'
  const isNoInternet = display === 'no-internet'
  // The tunnel is proven but its address is not confirmed yet (lookup failed, or still showed the
  // pre-VPN address while routes switched). Shown as ordinary "Securing connection" / "Checking
  // IP" for ADDRESS_GRACE_MS, and only then as the softer "VPN connected": lookups keep retrying.
  const addressPending =
    display === 'verifying' && (reason === 'ip-unavailable' || reason === 'ip-unchanged')
  const addressSlow = useAfterDelay(addressPending, ADDRESS_GRACE_MS)
  // "Could not verify" only for real faults, never while a connection is being set up or confirmed.
  const ipFailed =
    display === 'unknown' ||
    isNoInternet ||
    (display === 'disconnected' && ipState === 'unavailable')

  const serverRequest = useRef(0)
  // Fetches the list for `request`; a newer request (or leaving the screen) makes its answer stale.
  const fetchServers = useCallback(
    (request: number) => {
      loadServerList(account.username, () => window.api.vpn.listServers())
        .then((list) => {
          if (request !== serverRequest.current) return
          setServers(list)
          setServersError('')
          setServersLoading(false)
        })
        .catch((e) => {
          if (request !== serverRequest.current) return
          setServersError(
            e instanceof Error ? cleanIpcErrorMessage(e.message) : 'Failed to load servers.'
          )
          setServersLoading(false)
        })
    },
    [account.username]
  )

  // The list starts out "loading" and without an error (the state's initial values), so the
  // first load sets no state here. A cached session list needs no request at all.
  useEffect(() => {
    if (needsFetch) fetchServers(++serverRequest.current)
    return () => {
      serverRequest.current += 1
    }
  }, [fetchServers, needsFetch])

  // "Retry": an event handler, so it may reset the loading/error state itself.
  const loadServers = useCallback(() => {
    const request = ++serverRequest.current
    setServersLoading(true)
    setServersError('')
    fetchServers(request)
  }, [fetchServers])

  // If the first load failed, retry automatically when connectivity is usable again.
  // Successful lists are never re-fetched because of health changes. Native health is the
  // source here: WebView navigator.onLine does not reliably reflect VPN/network recovery.
  const serverRetryDelay = serverListRetryDelay({ network: health.network, display, ipState })
  const wasOffline = useRef(false)
  useEffect(() => {
    if (wasOffline.current && serverRetryDelay !== undefined) resetServerListRetry(account.username)
    if (display === 'no-internet' || health.network === 'down') wasOffline.current = true
    else if (serverRetryDelay !== undefined) wasOffline.current = false
    return scheduleServerListRetry(
      account.username,
      serversError,
      serversLoading,
      serverRetryDelay,
      loadServers
    )
  }, [
    account.username,
    serversError,
    serversLoading,
    serverRetryDelay,
    loadServers,
    display,
    health.network
  ])

  const visibleServers = useMemo(() => {
    const base = servers.filter((s) => tab !== 'favorites' || isFavorite(s.id))
    return [...base].sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1
      if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1
      return a.countryName.localeCompare(b.countryName)
    })
    // isFavorite closes over the favorites Set, which changes identity on
    // every toggle — including it (rather than just `servers`/`tab`) is
    // what makes toggling a favorite while on the Favorites tab actually
    // re-filter the visible list immediately.
  }, [servers, tab, isFavorite])

  // Keep one fixed-height canvas throughout scrolling. Moving the mounted slice
  // must not change scrollHeight or reposition the remaining rows. Polling each
  // animation frame also covers native momentum scrolls between DOM scroll events.
  const serverListRef = useRef<HTMLDivElement>(null)
  const [virtualRange, setVirtualRange] = useState({ start: 0, end: visibleServers.length })
  useLayoutEffect(() => {
    const element = serverListRef.current
    if (!element) return
    let lastScrollTop = -1
    let lastHeight = -1
    const updateRange = (): void => {
      const scrollTop = element.scrollTop
      const height = element.clientHeight
      // Keep polling every frame so momentum scrolling stays smooth, but skip the React state
      // update and range allocation on every idle frame.
      if (scrollTop === lastScrollTop && height === lastHeight) return
      lastScrollTop = scrollTop
      lastHeight = height
      setVirtualRange((previous) => {
        const next = computeVirtualRange(
          scrollTop,
          height,
          visibleServers.length,
          SERVER_ROW_HEIGHT,
          SERVER_ROW_GAP
        )
        return next.start === previous.start && next.end === previous.end ? previous : next
      })
    }
    // Recompute before paint after filtering or loading changes the list length.
    updateRange()
    let frame = requestAnimationFrame(function tick() {
      updateRange()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [visibleServers.length])

  const displayedServerId = isConnected
    ? health.serverId
    : isTransitioning
      ? (health.serverId ?? selectedServerId)
      : selectedServerId
  const selectedServer = servers.find((s) => s.id === displayedServerId)

  async function handleToggle(): Promise<void> {
    setError('')
    if (!isConnected && !selectedServerId) {
      setError(t('selectServerFirst'))
      return
    }
    try {
      await getHealthStore().toggle(selectedServerId)
    } catch (e) {
      setError(e instanceof Error ? cleanIpcErrorMessage(e.message) : 'Connection request failed.')
    }
  }

  return (
    <div className="screen connect-screen">
      <div className="connect-header">
        <Brand compact />
        <button className="btn-icon" onClick={onMenu} title={t('menu')} aria-label={t('menu')}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {autoConnectError && (
        <div className="form-error auto-connect-error" role="alert">
          <span>
            {t('autoConnectFailedLabel')}: {t(autoConnectErrorReason(autoConnectError.code))}
          </span>
          <button
            className="auto-connect-error-dismiss"
            type="button"
            onClick={() => void getHealthStore().acknowledgeAutoConnectError(autoConnectError.id)}
            aria-label={t('dismiss')}
            title={t('dismiss')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <section
        className={[
          'connection-card',
          isProtected ? 'connection-card--protected' : '',
          isProtected ? 'connection-card--connected' : '',
          display === 'disconnected' ? 'connection-card--disconnected' : '',
          display === 'unknown' || isNoInternet ? 'connection-card--warning' : ''
        ].join(' ')}
        aria-label={t('connectionDetails')}
      >
        <div className="connection-heading">
          <div
            className={[
              'status-circle',
              isProtected ? 'status-circle--connected' : '',
              isTransitioning || display === 'verifying' ? 'status-circle--pulse' : ''
            ].join(' ')}
          >
            <AppIcon name="shield" size={24} />
          </div>
          <div className="connection-heading-copy">
            <div className="status-text" role="status" aria-live="polite">
              {display === 'checking' && t('statusChecking')}
              {display === 'unknown' && t('statusUnknown')}
              {display === 'verifying' &&
                t(addressSlow ? 'statusConnectedUnverified' : 'statusVerifying')}
              {display === 'disconnected' && t('statusNotConnected')}
              {display === 'connecting' && t('statusConnecting')}
              {isProtected && t('statusConnected')}
              {isNoInternet && t('statusNoInternet')}
              {display === 'disconnecting' && t('statusDisconnecting')}
            </div>
            <p className="connection-caption">
              {display === 'unknown'
                ? t('connectionUnavailable')
                : isNoInternet
                  ? t(
                      reason === 'no-response'
                        ? health.tunnelUp
                          ? 'connectionNoResponse'
                          : 'connectionNoResponseDisconnected'
                        : health.tunnelUp
                          ? 'connectionNoUplink'
                          : 'connectionNoUplinkDisconnected'
                    )
                  : isProtected
                    ? t('connectionReady')
                    : reason === 'stale'
                      ? t('connectionStale')
                      : addressSlow
                        ? t('connectionAddressUnchecked')
                        : isConnected || isTransitioning || isChecking
                          ? t('connectionInProgress')
                          : t('connectionPrompt')}
            </p>
          </div>
          <span
            className={['connection-indicator', isProtected ? 'connection-indicator--on' : ''].join(
              ' '
            )}
            aria-hidden="true"
          />
        </div>
        <dl className="connection-details">
          <div className="connection-location">
            <dt>{isConnected || isTransitioning ? t('serverLocation') : t('selectedLocation')}</dt>
            <dd>
              {selectedServer ? (
                <>
                  <CountryFlag code={selectedServer.countryCode} />
                  <span>
                    {selectedServer.countryName}
                    {selectedServer.city && (
                      <span className="location-city"> · {selectedServer.city}</span>
                    )}
                  </span>
                </>
              ) : (
                <span className="detail-placeholder">
                  {isConnected ? t('locationUnavailable') : t('chooseLocation')}
                </span>
              )}
            </dd>
          </div>
          <div className="connection-ip">
            <dt>{isConnected || display === 'connecting' ? t('vpnIp') : t('yourIp')}</dt>
            <dd aria-live="polite">
              {publicIp ? (
                <span
                  className={['ip-address', publicIp.ip.includes(':') ? 'ip-address--v6' : ''].join(
                    ' '
                  )}
                >
                  {publicIp.ip.includes(':')
                    ? publicIp.ip.split(':').map((part, index, parts) => (
                        <span key={index}>
                          {part}
                          {index < parts.length - 1 && (
                            <>
                              :<wbr />
                            </>
                          )}
                        </span>
                      ))
                    : publicIp.ip}
                </span>
              ) : (
                <span className="ip-placeholder">
                  {ipFailed ? (
                    t('ipUnavailable')
                  ) : (
                    <>
                      <span className="loading-dot" aria-hidden="true" />
                      {t('ipChecking')}
                    </>
                  )}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="locations-toolbar">
        <div className="server-tabs">
          <button
            className={['server-tab', tab === 'all' ? 'server-tab--active' : ''].join(' ')}
            onClick={() => connectPreferences.update(account.username, { tab: 'all' })}
            aria-pressed={tab === 'all'}
          >
            {t('allServers')}
          </button>
          <button
            className={['server-tab', tab === 'favorites' ? 'server-tab--active' : ''].join(' ')}
            onClick={() => connectPreferences.update(account.username, { tab: 'favorites' })}
            aria-pressed={tab === 'favorites'}
          >
            {t('favorites')}
          </button>
        </div>
      </div>

      <div
        className="server-list"
        ref={serverListRef}
        aria-label={t('allServers')}
        aria-busy={serversLoading}
      >
        {serversLoading && servers.length === 0 && (
          <div className="server-list-message">{t('loadingServers')}</div>
        )}

        {!serversLoading && serversError && servers.length === 0 && (
          <div className="server-list-message server-list-message--error" role="alert">
            <span>{serversError}</span>
            <button className="btn-secondary servers-retry" type="button" onClick={loadServers}>
              {t('retry')}
            </button>
          </div>
        )}

        {!serversLoading && !serversError && visibleServers.length === 0 && (
          <div className="server-list-message">
            {tab === 'favorites' ? t('noFavoriteServers') : t('noServersAvailable')}
          </div>
        )}

        {visibleServers.length > 0 && (
          <div
            className="server-list-content"
            style={{
              height: virtualListHeight(visibleServers.length, SERVER_ROW_HEIGHT, SERVER_ROW_GAP)
            }}
          >
            {visibleServers.slice(virtualRange.start, virtualRange.end).map((server, index) => (
              <div
                style={{
                  position: 'absolute',
                  top: (virtualRange.start + index) * (SERVER_ROW_HEIGHT + SERVER_ROW_GAP),
                  height: SERVER_ROW_HEIGHT,
                  left: 0,
                  right: 0
                }}
                key={server.id}
                className={[
                  'server-item',
                  server.id === displayedServerId ? 'server-item--selected' : ''
                ].join(' ')}
              >
                <button
                  className="server-item-main"
                  onClick={() => {
                    connectPreferences.update(account.username, { serverId: server.id })
                    setError('')
                  }}
                  disabled={isConnected || isTransitioning || isChecking}
                  aria-pressed={server.id === displayedServerId}
                >
                  <span className="server-item-flag">
                    <CountryFlag code={server.countryCode} />
                  </span>
                  <span className="server-item-text">
                    <span className="server-item-country">{server.countryName}</span>
                    {server.city && <span className="server-item-city">{server.city}</span>}
                  </span>
                  {server.id === displayedServerId ? (
                    <span className="server-selected-mark" title={t('selected')}>
                      <AppIcon name="check" size={16} />
                    </span>
                  ) : (
                    server.isRecommended && (
                      <span className="server-item-badge">{t('recommended')}</span>
                    )
                  )}
                </button>
                <button
                  className={[
                    'server-item-favorite',
                    isFavorite(server.id) ? 'server-item-favorite--active' : ''
                  ].join(' ')}
                  onClick={() => toggleFavorite(server.id)}
                  title={isFavorite(server.id) ? t('removeFavorite') : t('addFavorite')}
                  aria-label={isFavorite(server.id) ? t('removeFavorite') : t('addFavorite')}
                  aria-pressed={isFavorite(server.id)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill={isFavorite(server.id) ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="connect-controls">
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <button
          className={['btn-primary btn-connect', isConnected ? 'btn-connect--disconnect' : ''].join(
            ' '
          )}
          onClick={handleToggle}
          disabled={isTransitioning || isChecking || (!isConnected && !selectedServerId)}
        >
          <AppIcon name="power" size={19} />
          {display === 'disconnected' && t('connect')}
          {display === 'connecting' && t('statusConnecting')}
          {isConnected && t('disconnect')}
          {isChecking && t('statusChecking')}
          {display === 'disconnecting' && t('statusDisconnecting')}
        </button>
      </div>
    </div>
  )
}
