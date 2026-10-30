// Each flag is a separate file the browser loads only when it is shown.
// Bundled as components, the 260+ flags were most of the script parsed
// before the first window could paint.
const FLAG_FILES = import.meta.glob<string>('../../../../node_modules/country-flag-icons/3x2/*.svg', {
  eager: true,
  query: '?no-inline',
  import: 'default'
})

const FLAGS = new Map(
  Object.entries(FLAG_FILES).map(([path, url]) => [path.slice(-6, -4), url])
)

/** The flag image URL for a two-letter code, case-insensitively. Undefined for anything else, so callers can fall back to a generic glyph. */
export function countryFlagUrl(countryCode: string): string | undefined {
  if (!/^[A-Za-z]{2}$/.test(countryCode)) return undefined
  return FLAGS.get(countryCode.toUpperCase())
}
