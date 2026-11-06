import { useSyncExternalStore } from 'react'
import type { HealthSnapshot } from '../../../shared/connectionHealth'
import { DesktopHealthStore, type AutoConnectErrorInfo, type HealthStore } from './healthStore'
let shared: HealthStore | undefined
export function getHealthStore(): HealthStore { return (shared ??= new DesktopHealthStore(window.api.vpn)) }
export function useHealth(): HealthSnapshot { const store = getHealthStore(); return useSyncExternalStore(store.subscribe, store.getSnapshot) }
export function useAutoConnectError(): AutoConnectErrorInfo | null { const store = getHealthStore(); return useSyncExternalStore(store.subscribeAutoConnectError, store.getAutoConnectError) }
