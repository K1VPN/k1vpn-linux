import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SNAP_PERMISSION_COMMAND } from '../../../shared/snapPermissions'
import { translations } from '../i18n/translations'
import { LanguageProvider } from '../i18n/LanguageContext'
import { SnapPermissionHelp } from './SnapPermissionHelp'

afterEach(() => vi.unstubAllGlobals())

describe('Snap permission help', () => {
  for (const language of ['en', 'el'] as const) {
    it(`offers a selectable command and copy button in ${language}`, () => {
      vi.stubGlobal('window', {
        localStorage: { getItem: () => language },
        api: { app: { setLanguage: async () => {} } }
      })
      const html = renderToStaticMarkup(createElement(LanguageProvider, null, createElement(SnapPermissionHelp)))
      expect(html).toContain(translations[language].copyCommand)
      expect(html).toContain(translations[language].snapPermissionHint)
      expect(html).toContain('<code class="snap-permission-command" tabindex="0">')
      expect(html).toContain(SNAP_PERMISSION_COMMAND.replaceAll('&', '&amp;'))
      expect(html).toContain('type="button"')
    })
  }
})
