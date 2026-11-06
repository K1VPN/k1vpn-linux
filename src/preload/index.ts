import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ClientApi } from '../shared/contracts'
const api: ClientApi = {
  updates: { get: () => ipcRenderer.invoke('updates:get'), check: () => ipcRenderer.invoke('updates:check'), install: () => ipcRenderer.invoke('updates:install') },
  settings: { get: () => ipcRenderer.invoke('settings:get'), set: (key, value) => ipcRenderer.invoke('settings:set', key, value), setDns: (mode, custom) => ipcRenderer.invoke('settings:setDns', mode, custom) },
  app: { quit: () => ipcRenderer.invoke('app:quit'), setLanguage: (language) => ipcRenderer.invoke('app:setLanguage', language) },
  vpn: {
    restartService: () => ipcRenderer.invoke('vpn:restartService'), ping: () => ipcRenderer.invoke('vpn:ping'), status: () => ipcRenderer.invoke('vpn:status'), connect: (serverId) => ipcRenderer.invoke('vpn:connect', serverId), disconnect: () => ipcRenderer.invoke('vpn:disconnect'), listServers: () => ipcRenderer.invoke('vpn:listServers'), publicIp: () => ipcRenderer.invoke('vpn:publicIp'),
    autoConnectError: { get: () => ipcRenderer.invoke('vpn:autoConnectError'), acknowledge: (id) => ipcRenderer.invoke('vpn:autoConnectError:acknowledge', id), subscribe: (listener) => { const handler = (_event: IpcRendererEvent, error: unknown): void => listener(error); ipcRenderer.on('vpn:autoConnectError:changed', handler); return () => ipcRenderer.removeListener('vpn:autoConnectError:changed', handler) } },
    health: { get: () => ipcRenderer.invoke('vpn:health'), refresh: () => ipcRenderer.invoke('vpn:health:refresh'), allowLookup: () => ipcRenderer.invoke('vpn:health:allowLookup'), subscribe: (listener) => { const handler = (_event: IpcRendererEvent, snapshot: unknown): void => listener(snapshot); ipcRenderer.on('vpn:health:changed', handler); return () => ipcRenderer.removeListener('vpn:health:changed', handler) } }
  },
  auth: { forgetCredentials: () => ipcRenderer.invoke('auth:forgetCredentials'), login: (username, password, remember) => ipcRenderer.invoke('auth:login', { username, password, remember }), getRememberedLogin: () => ipcRenderer.invoke('auth:getRememberedLogin'), loginWithSavedCredentials: () => ipcRenderer.invoke('auth:loginWithSavedCredentials'), restoreSession: () => ipcRenderer.invoke('auth:restoreSession'), refreshAccount: () => ipcRenderer.invoke('auth:refreshAccount'), logout: () => ipcRenderer.invoke('auth:logout') }
}
contextBridge.exposeInMainWorld('api', api)
