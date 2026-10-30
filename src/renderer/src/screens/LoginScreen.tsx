import { useEffect, useRef, useState } from 'react'
import { VpnAccount } from '../types'
import { useLanguage } from '../i18n/useLanguage'
import { cleanIpcErrorMessage } from '../lib/ipcError'
import { shouldUseManualLogin } from '../lib/rememberedLoginError'
import { privacyPolicyUrl, termsOfUseUrl } from '../lib/links'
import { Brand } from '../components/Brand'
import { LanguageSwitch } from '../components/LanguageSwitch'

interface Props {
  onSuccess: (account: VpnAccount) => void
}

export default function LoginScreen({ onSuccess }: Props): React.JSX.Element {
  const { t, language } = useLanguage()
  // 'checking' avoids flashing the blank form before we know whether
  // there's a remembered login to offer instead.
  const [mode, setMode] = useState<'checking' | 'quick' | 'form'>('checking')
  const [rememberedUsername, setRememberedUsername] = useState('')

  // Guards against a stale sign-in attempt's result landing after a newer
  // one has already started (e.g. a fast double-submit, or the main
  // process's own OperationSupersededError from authClient.ts) — the
  // main process already refuses to commit a superseded attempt's result
  // to shared state, but this component must independently avoid acting
  // on (showing an error for, or transitioning the screen on) a promise
  // that isn't for the *current* attempt either. Two separate guards
  // against two separate failure modes, not one substituting for the
  // other.
  const attemptIdRef = useRef(0)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  // Required for a manual sign-in, never stored: it starts unticked every time the form
  // is shown. The remembered-login path ("Continue as ...") does not ask again.
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missingField, setMissingField] = useState<'username' | 'password' | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // Only the username is ever asked for here — never the stored password
  // itself (see authClient.ts's getRememberedLogin). Signing in with the
  // remembered login happens entirely in the main process via
  // loginWithSavedCredentials(); this screen's password field is only
  // ever filled by what the user types.
  useEffect(() => {
    let cancelled = false
    window.api.auth.getRememberedLogin().then((remembered) => {
      if (cancelled) return
      if (remembered) {
        setRememberedUsername(remembered.username)
        setMode('quick')
      } else {
        setMode('form')
      }
    }).catch((e: unknown) => {
      if (cancelled) return
      setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
      setMode('form')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleQuickSignIn(): Promise<void> {
    const attemptId = ++attemptIdRef.current
    setError('')
    setLoading(true)
    try {
      const account = await window.api.auth.loginWithSavedCredentials()
      if (attemptIdRef.current !== attemptId) return // a newer attempt has since started — ignore this result
      onSuccess(account)
    } catch (e) {
      if (attemptIdRef.current !== attemptId) return
      setError(e instanceof Error ? cleanIpcErrorMessage(e.message) : 'Failed to sign in.')
      // Temporary failures keep the saved-login button available for retry.
      if (shouldUseManualLogin(e)) {
        setUsername(rememberedUsername)
        setRemember(true)
        setMode('form')
      }
    } finally {
      if (attemptIdRef.current === attemptId) setLoading(false)
    }
  }

  async function useDifferentAccount(): Promise<void> {
    setLoading(true)
    try {
      await window.api.auth.forgetCredentials()
      setError('')
      setUsername('')
      setPassword('')
      setRemember(false)
      setTermsAccepted(false)
      setShowPassword(false)
      setMode('form')
    } catch (e) {
      setError(cleanIpcErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const missing = !username.trim() ? 'username' : !password ? 'password' : null
    setMissingField(missing)
    if (missing) {
      setError('')
      const form = e.currentTarget as HTMLFormElement
      form.querySelector<HTMLInputElement>(`#login-${missing}`)?.focus()
      return
    }
    if (!termsAccepted) return
    const attemptId = ++attemptIdRef.current
    setError('')
    setLoading(true)
    try {
      const account = await window.api.auth.login(username, password, remember)
      if (attemptIdRef.current !== attemptId) return
      onSuccess(account)
    } catch (e) {
      if (attemptIdRef.current !== attemptId) return
      setError(e instanceof Error ? cleanIpcErrorMessage(e.message) : 'Failed to sign in.')
    } finally {
      if (attemptIdRef.current === attemptId) setLoading(false)
    }
  }

  if (mode === 'checking') {
    return (
      <div className="screen login-screen">
        <LoginBranding />
        <div className="login-panel">
          <p className="login-subtitle" role="status">
            {t('checkingAccount')}
          </p>
        </div>
        <LoginFooter />
      </div>
    )
  }

  if (mode === 'quick') {
    return (
      <div className="screen login-screen">
        <LoginBranding />
        <div className="login-panel">
          <p className="login-subtitle">{t('welcomeBack')}</p>
          <div className="login-form">
            <p className="totp-hint">{t('continueAsQuestion', { username: rememberedUsername })}</p>

            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}

            <button className="btn-primary" onClick={handleQuickSignIn} disabled={loading}>
              {loading ? t('signingIn') : t('continueAs', { username: rememberedUsername })}
            </button>

            <button
              className="btn-back"
              onClick={useDifferentAccount}
              disabled={loading}
              type="button"
            >
              {t('useDifferentAccount')}
            </button>
          </div>
        </div>
        <LoginFooter />
      </div>
    )
  }

  return (
    <div className="screen login-screen">
      <LoginBranding />
      <div className="login-panel">
        <p className="login-subtitle">{t('loginSubtitle')}</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="login-username">
              {t('vpnUsername')}
            </label>
            <input
              id="login-username"
              className="form-input"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                if (missingField === 'username') setMissingField(null)
              }}
              aria-invalid={missingField === 'username'}
              aria-describedby={missingField === 'username' ? 'login-validation' : undefined}
              placeholder="k1_xxxxxxxxxxxx"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              {t('vpnPassword')}
            </label>
            <div className="form-password-wrapper">
              <input
                id="login-password"
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (missingField === 'password') setMissingField(null)
                }}
                aria-invalid={missingField === 'password'}
                aria-describedby={missingField === 'password' ? 'login-validation' : undefined}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="form-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? t('hidePassword') : t('showPassword')}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="form-checkbox-row">
            <input
              id="login-remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <label htmlFor="login-remember">{t('rememberCredentials')}</label>
          </div>

          <div className="form-checkbox-row">
            <input
              id="login-terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
            />
            <label htmlFor="login-terms">
              {t('consentAcceptThe')}{' '}
              <a href={termsOfUseUrl(language)} target="_blank" rel="noreferrer">
                {t('termsOfUse')}
              </a>{' '}
              {t('consentAnd')}{' '}
              <a href={privacyPolicyUrl(language)} target="_blank" rel="noreferrer">
                {t('privacyPolicy')}
              </a>
            </label>
          </div>

          {missingField && (
            <div id="login-validation" className="form-error" role="alert">
              {t(missingField === 'username' ? 'usernameRequired' : 'passwordRequired')}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={loading || !termsAccepted}>
            {loading ? t('signingIn') : t('signIn')}
          </button>
        </form>
      </div>
      <LoginFooter />
    </div>
  )
}

function LoginBranding(): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <div className="login-branding">
      <LanguageSwitch />
      <Brand />
      <p className="login-tagline">{t('loginTagline')}</p>
    </div>
  )
}

// Informational only: no purchase link, price or payment instruction anywhere in
// the app. Whether the account really has an active subscription is decided by the
// account checks (authClient / AuthManager), never by this text.
function LoginFooter(): React.JSX.Element {
  const { t } = useLanguage()
  return (
    <footer className="login-footer">
      <span>{t('subscriptionRequired')}</span>
    </footer>
  )
}
