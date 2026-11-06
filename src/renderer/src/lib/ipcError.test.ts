import { describe, expect, it } from 'vitest'
import { cleanIpcErrorMessage } from './ipcError'

describe('cleanIpcErrorMessage', () => {
  it('strips the Electron invoke() wrapper and the original error class name', () => {
    expect(
      cleanIpcErrorMessage(
        "Error invoking remote method 'auth:login': ApiError: Invalid username or password."
      )
    ).toBe('Invalid username or password.')
  })

  it('strips the wrapper for a plain built-in Error (name is just "Error")', () => {
    expect(
      cleanIpcErrorMessage(
        "Error invoking remote method 'auth:restoreSession': Error: No remembered VPN credentials to sign in with."
      )
    ).toBe('No remembered VPN credentials to sign in with.')
  })

  it("strips the wrapper for any of this app's other error classes", () => {
    expect(
      cleanIpcErrorMessage(
        "Error invoking remote method 'vpn:connect': VpnDaemonError: tunnel establishment is not implemented yet"
      )
    ).toBe('tunnel establishment is not implemented yet')
  })

  it('leaves a message with no IPC wrapper completely unchanged', () => {
    expect(cleanIpcErrorMessage('Select a server first.')).toBe('Select a server first.')
    expect(cleanIpcErrorMessage('K1VPN server returned an unexpected error (500).')).toBe(
      'K1VPN server returned an unexpected error (500).'
    )
  })

  it('does not eat real message text that happens to contain a colon later on', () => {
    expect(
      cleanIpcErrorMessage(
        "Error invoking remote method 'auth:login': ApiError: Ratio 3:2 is invalid."
      )
    ).toBe('Ratio 3:2 is invalid.')
  })
})
