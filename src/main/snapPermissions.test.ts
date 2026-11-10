import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { SNAP_PERMISSION_COMMAND, isSnapPermissionMessage } from '../shared/snapPermissions'

it('offers the exact permission command required by the daemon', () => {
  const source = readFileSync('daemon/src/snap.rs', 'utf8')
  const message = source.match(/pub const MISSING_MESSAGE: &str = "([\s\S]*?)";/)![1]
    .replace(/\\\n/g, '').replace(/\s+/g, ' ')
  expect(message).toContain(SNAP_PERMISSION_COMMAND)
  expect(isSnapPermissionMessage(message)).toBe(true)
  expect(isSnapPermissionMessage('Permission denied')).toBe(false)
})
