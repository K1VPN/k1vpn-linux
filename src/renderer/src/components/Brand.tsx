import logoUrl from '../assets/branding/k1vpn-logo.png'

export function Brand({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={compact ? 'brand brand--compact' : 'brand'} aria-label="K1VPN">
      <img className="brand-logo" src={logoUrl} alt="K1VPN" />
    </div>
  )
}
