import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { THIRD_PARTY_PACKAGES } from '../../../shared/thirdParty'
import { isAllowedExternalUrl } from '../../../main/security'

// The real LanguageProvider, LoginScreen and AboutScreen rendered on the server
// (effects do not run, so no IPC is needed): what a user actually sees on the
// two shared screens, in each language.

type Screen = 'about' | 'login' | 'notice' | 'licenses'
// The screens read `window` and the build-time __APP_VERSION__; stubbed as plain globals.
const g = globalThis as unknown as Record<string, unknown>

async function render(screen: Screen, language: 'en' | 'el'): Promise<string> {
  // What the renderer reads from `window`: the stored language and (About) capabilities.
  g.window = {
    localStorage: { getItem: () => language, setItem: () => {} },
    api: {
      capabilities: {
        autoStart: false,
        autoConnect: false,
        killSwitchToggle: false,
        updater: false,
        quit: false,
        serviceRestart: false,
        customTitleBar: false
      }
    }
  }
  const { LanguageProvider } = await import('../i18n/LanguageContext')
  const Screen =
    screen === 'about'
      ? (await import('./AboutScreen')).default
      : screen === 'licenses'
        ? (await import('./ThirdPartyScreen')).default
      : screen === 'notice'
        ? (await import('./VpnNoticeScreen')).default
        : (await import('./LoginScreen')).default
  const props =
    (screen === 'about' || screen === 'licenses')
      ? { onBack: () => {} }
      : screen === 'notice'
        ? { onAccept: () => {} }
        : { onSuccess: () => {} }
  return renderToStaticMarkup(
    createElement(LanguageProvider, null, createElement(Screen as never, props as never))
  )
}

const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
// Only real links (the logo is an image with its own href).
const links = (html: string): string[] => hrefs(html).filter((h) => /^https?:/.test(h))

beforeAll(() => {
  g.__APP_VERSION__ = 'test'
})
afterEach(() => {
  delete g.window
})

describe('sign-in screen', () => {
  it('tells the user a subscription is required, in English', async () => {
    const html = await render('login', 'en')
    expect(html).toContain('An active K1VPN subscription is required to use this app.')
  })

  it('tells the user a subscription is required, in Greek', async () => {
    const html = await render('login', 'el')
    expect(html).toContain('Για να λειτουργήσει η εφαρμογή, απαιτείται ενεργή συνδρομή στην K1VPN.')
  })

  it('offers no way to buy: no links at all, and no purchase call to action', async () => {
    for (const language of ['en', 'el'] as const) {
      const html = await render('login', language)
      expect(html, language).not.toMatch(/<a[\s>]/)
      expect(html, language).not.toMatch(/pricing|Get one now|Απόκτησέ την/i)
    }
  })
})

describe('Third-party screen', () => {
  it('shows concise package credits with working external license links in both languages', async () => {
    for (const language of ['en', 'el'] as const) {
      const html = await render('licenses', language)
      expect(html).toContain(language === 'el' ? 'Άδειες τρίτων' : '3rd party licences')
      expect(html).not.toContain('SIL OPEN FONT LICENSE Version')
      expect(html).not.toContain('href="#licenses"')
      for (const component of THIRD_PARTY_PACKAGES) {
        expect(html).toContain(component.name)
        for (const license of component.licenses) {
          expect(hrefs(html)).toContain(license.url)
          expect(isAllowedExternalUrl(license.url)).toBe(true)
          expect(html).toContain(`href="${license.url}" target="_blank" rel="noreferrer"`)
        }
      }
    }
  })
})

describe('About screen', () => {
  it('keeps credits on their separate page behind the original footer link', async () => {
    for (const language of ['en', 'el'] as const) {
      const html = await render('about', language)
      expect(hrefs(html)).toContain('#licenses')
      expect(html).not.toContain('about-license-row')
      expect(html).not.toContain('country-flag-icons')
    }
  })

  it('links the English privacy policy when the UI is English', async () => {
    const html = await render('about', 'en')
    expect(hrefs(html)).toContain('https://k1vpn.com/en/privacy-policy/')
    expect(html).toContain('Privacy policy')
  })

  it('links the Greek privacy policy when the UI is Greek', async () => {
    const html = await render('about', 'el')
    expect(hrefs(html)).toContain('https://k1vpn.com/privacy-policy/')
    expect(html).toContain('Πολιτική απορρήτου')
  })

  it('opens it outside the app and never points anywhere near a purchase page', async () => {
    for (const language of ['en', 'el'] as const) {
      const html = await render('about', language)
      const anchor = html.match(/<a[^>]*privacy-policy[^>]*>/)?.[0] ?? ''
      expect(anchor, language).toContain('target="_blank"')
      expect(anchor, language).toContain('rel="noreferrer"')
      for (const href of hrefs(html))
        expect(href, language).not.toMatch(/pricing|checkout|buy|subscribe/i)
    }
  })
})

describe('VPN notice shown before a manual sign-in', () => {
  it('explains the VPN and offers accept and decline, in English', async () => {
    const html = await render('notice', 'en')
    expect(html).toContain('Before you start')
    expect(html).toContain('to help protect your internet traffic')
    expect(html).toContain('>Accept<')
    expect(html).toContain('>Decline<')
    expect(links(html)).toEqual(['https://k1vpn.com/en/privacy-policy/'])
  })

  it('explains the VPN and offers accept and decline, in Greek', async () => {
    const html = await render('notice', 'el')
    expect(html).toContain('Πριν ξεκινήσετε')
    expect(html).toContain('ώστε να συμβάλλει στην προστασία της κίνησης internet σας')
    expect(html).toContain('>Αποδοχή<')
    expect(html).toContain('>Απόρριψη<')
    expect(links(html)).toEqual(['https://k1vpn.com/privacy-policy/'])
  })

  it('names no third-party service', async () => {
    for (const language of ['en', 'el'] as const) {
      const html = await render('notice', language)
      expect(html, language).not.toMatch(/geojs|google|analytics\.|facebook/i)
    }
  })
})

describe('language choice before sign-in', () => {
  it('offers Greek and English on the VPN notice, marking the current one', async () => {
    const html = await render('notice', 'el')
    expect(html).toContain('>Ελληνικά<')
    expect(html).toContain('>English<')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Ελληνικά</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>English</)
  })

  it('offers it on the login screen too', async () => {
    const html = await render('login', 'en')
    expect(html).toMatch(/aria-pressed="true"[^>]*>English</)
    expect(html).toContain('>Ελληνικά<')
  })
})

describe('starting language', () => {
  it('is English until the user picks another, even on a Greek device', async () => {
    g.window = {
      localStorage: { getItem: () => null, setItem: () => {} },
      navigator: { language: 'el-GR', languages: ['el-GR'] },
      api: { app: { setLanguage: async () => {} } }
    }
    const { LanguageProvider } = await import('../i18n/LanguageContext')
    const Notice = (await import('./VpnNoticeScreen')).default
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, null, createElement(Notice, { onAccept: () => {} }))
    )
    expect(html).toContain('Before you start')
    expect(html).toMatch(/aria-pressed="true"[^>]*>English</)
  })
})
