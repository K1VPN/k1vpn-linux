import { useSyncExternalStore } from 'react'
import { connectPreferences, type ConnectPreferences } from './connectPreferences'

export function useConnectPreferences(account: string): ConnectPreferences {
  return useSyncExternalStore(connectPreferences.subscribe, () => connectPreferences.read(account))
}
