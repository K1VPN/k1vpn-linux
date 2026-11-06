import { describe, expect, it } from 'vitest'
import { translations } from './translations'

describe('translations', () => {
  it('have exactly the same keys in both languages, none of them empty', () => {
    expect(Object.keys(translations.el).sort()).toEqual(Object.keys(translations.en).sort())
    for (const language of ['en', 'el'] as const) {
      for (const [key, value] of Object.entries(translations[language])) {
        expect(value.trim(), `${language}.${key}`).not.toBe('')
      }
    }
  })

  it('state the subscription requirement as plain information', () => {
    expect(translations.en.subscriptionRequired).toBe(
      'An active K1VPN subscription is required to use this app.'
    )
    expect(translations.el.subscriptionRequired).toBe(
      'Για να λειτουργήσει η εφαρμογή, απαιτείται ενεργή συνδρομή στην K1VPN.'
    )
  })

  it('label the privacy policy link in both languages', () => {
    expect(translations.en.privacyPolicy).toBe('Privacy policy')
    expect(translations.el.privacyPolicy).toBe('Πολιτική απορρήτου')
  })

  it('contain no purchase call to action or URL', () => {
    expect(Object.keys(translations.en)).not.toContain('getSubscriptionNow')
    expect(Object.keys(translations.el)).not.toContain('getSubscriptionNow')
    for (const language of ['en', 'el'] as const) {
      for (const [key, value] of Object.entries(translations[language])) {
        expect(value, `${language}.${key}`).not.toMatch(/https?:\/\//i)
      }
    }
  })
})
