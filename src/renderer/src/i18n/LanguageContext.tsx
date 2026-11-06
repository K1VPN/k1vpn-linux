import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LANGUAGE, Language, TranslationKey, translations } from './translations'
import { LanguageContext } from './context'

const STORAGE_KEY = 'k1vpn-language'

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'el'
}

// Renderer-only preference (which language to display), not anything
// sensitive — localStorage is the right place for it, unlike credentials
// (safeStorage, main-process only) or account data (never persisted client
// side at all). Wrapped in try/catch: localStorage can throw in some
// embedding contexts, and a UI language preference is never worth crashing
// the app over — falls back to the in-memory default for that session.
function loadStoredLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Non-fatal — the choice just won't survive a restart this time.
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<Language>(
    () => loadStoredLanguage() ?? DEFAULT_LANGUAGE
  )

  useEffect(() => {
    document.documentElement.lang = language
    void window.api.app.setLanguage(language).catch(console.error)
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    storeLanguage(next)
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string>): string => {
      const template = translations[language][key]
      if (!vars) return template
      return Object.entries(vars).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, value),
        template
      )
    },
    [language]
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
