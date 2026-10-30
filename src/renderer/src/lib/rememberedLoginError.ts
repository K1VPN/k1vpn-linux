import { cleanIpcErrorMessage } from './ipcError'

// Electron serializes only the error name and message.
// Only definite account/credential failures should ask for another password.
const MANUAL_LOGIN_MESSAGES = new Set([
  'Invalid username or password.',
  'This account is not available.',
  'This VPN account is disabled.',
  'This VPN account has expired.',
  'This VPN account is not active.',
  'No remembered VPN credentials to sign in with.'
])

export function shouldUseManualLogin(error: unknown): boolean {
  if (error instanceof Error && 'code' in error && error.code === 'AUTH') return true
  return error instanceof Error && MANUAL_LOGIN_MESSAGES.has(cleanIpcErrorMessage(error.message))
}
