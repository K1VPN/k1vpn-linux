/**
 * Electron's `ipcRenderer.invoke()` does not propagate a main-process
 * error's `.message` cleanly — when a handler throws, the renderer's
 * rejected promise gets a *new* Error whose message is
 * `Error invoking remote method '<channel>': <name>: <original message>`
 * (`<name>: <original message>` being exactly what `Error.prototype.
 * toString()` produces, since Electron serializes the thrown error via
 * that). Every one of this app's own error classes (ApiError,
 * ApiUnreachableError, VpnDaemonError, etc.) sets its own `.name`
 * explicitly, so this wrapper shape is consistent across all of them —
 * shown as-is, the user sees Electron's internal plumbing instead of the
 * actual message; e.g. `Error invoking remote method 'auth:login':
 * ApiError: Invalid username or password.` instead of just `Invalid
 * username or password.`.
 *
 * Safe to call on any string, IPC-wrapped or not — a message that doesn't
 * match the wrapper shape (e.g. a plain client-side validation message
 * that never went through invoke()) passes through unchanged.
 */
const IPC_INVOKE_ERROR_PREFIX =
  /^Error invoking remote method '[^']*':\s*(?:[A-Za-z][A-Za-z0-9]*:\s*)?/

export function cleanIpcErrorMessage(message: string): string {
  return message.replace(IPC_INVOKE_ERROR_PREFIX, '')
}
