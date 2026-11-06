import { describe, expect, it } from 'vitest'
import { shouldUseManualLogin } from './rememberedLoginError'

describe('remembered login failures', () => {
  it('keeps saved login available for temporary Linux client failures', () => {
    for (const message of [
      'K1VPN is temporarily unavailable. Please try again shortly.',
      'Cannot reach K1VPN servers. Check your internet connection.',
      'Too many requests. Please try again in a minute.'
    ]) {
      expect(
        shouldUseManualLogin(
          new Error(
            `Error invoking remote method 'auth:loginWithSavedCredentials': ApiError: ${message}`
          )
        )
      ).toBe(false)
    }
  })

  it('offers the form for definite credential/account failures', () => {
    expect(
      shouldUseManualLogin(
        new Error(
          "Error invoking remote method 'auth:loginWithSavedCredentials': ApiError: Invalid username or password."
        )
      )
    ).toBe(true)
    expect(shouldUseManualLogin(Object.assign(new Error('This account is not available.'), { code: 'AUTH' }))).toBe(true)
    expect(shouldUseManualLogin(new Error('This VPN account has expired.'))).toBe(true)
    expect(shouldUseManualLogin(new Error('No remembered VPN credentials to sign in with.'))).toBe(
      true
    )
  })
})
