import { useState } from 'react'
import { SNAP_PERMISSION_COMMAND } from '../../../shared/snapPermissions'
import { useLanguage } from '../i18n/useLanguage'

export function SnapPermissionHelp({ onCopied }: { onCopied?: () => void }): React.JSX.Element {
  const { t } = useLanguage()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy(): Promise<void> {
    try {
      await window.api.app.copyNetworkPermissionCommand()
      setCopyState('copied')
      onCopied?.()
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <div className="snap-permission-help">
      <p>{t('snapPermissionHint')}</p>
      <code className="snap-permission-command" tabIndex={0}>{SNAP_PERMISSION_COMMAND}</code>
      <button className="snap-permission-copy" type="button" onClick={() => void copy()}>
        {t('copyCommand')}
      </button>
      <span role="status" aria-live="polite">
        {copyState === 'copied' ? t('commandCopied') : copyState === 'failed' ? t('commandCopyFailed') : ''}
      </span>
    </div>
  )
}
