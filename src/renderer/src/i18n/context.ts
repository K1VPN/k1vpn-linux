import { createContext } from 'react'
import { Language, TranslationKey } from './translations'

export interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  /** `{name}`-style placeholders in the dictionary string are replaced from `vars`. */
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}

// Split into its own file (no components, no hooks) so neither
// LanguageContext.tsx (the Provider component) nor useLanguage.ts (the
// hook) mixes a non-component export into a component file — either one
// doing that breaks Vite/React Fast Refresh for that file.
export const LanguageContext = createContext<LanguageContextValue | null>(null)
