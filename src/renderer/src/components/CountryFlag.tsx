import { countryFlagUrl } from '../lib/countryFlag'

/** Render a consistent bundled SVG instead of relying on host emoji fonts. */
export function CountryFlag({ code }: { code: string }): React.JSX.Element {
  const url = countryFlagUrl(code)
  if (!url) {
    return (
      <span className="server-item-flag-fallback" aria-hidden="true">
        🌐
      </span>
    )
  }
  return <img className="server-item-flag-svg" src={url} alt="" aria-hidden="true" width={24} height={16} decoding="async" />
}
