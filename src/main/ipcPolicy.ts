import type { IpcMainInvokeEvent } from 'electron'

export function isTrustedIpcSource(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, trustedWebContents: ReadonlySet<number>): boolean {
  return (
    trustedWebContents.has(event.sender.id) &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  )
}

export function assertTrustedIpcSource(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, trustedWebContents: ReadonlySet<number>): void {
  if (!isTrustedIpcSource(event, trustedWebContents)) throw new Error('Untrusted IPC sender')
}
