import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('makes Chromium temporary icons host-visible on the very first Snap launch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'k1vpn-launch-'))
  try {
    const snap = join(directory, 'snap mount')
    const runtime = join(directory, 'runtime', 'snap.k1vpn')
    await mkdir(join(snap, 'k1vpn'), { recursive: true })
    await writeFile(join(snap, 'k1vpn', 'k1vpn'), '#!/bin/sh\n[ -d "$TMPDIR" ] || exit 42\nprintf "%s\\n" "$TMPDIR" "$@"\n', { mode: 0o755 })
    // The runtime directory deliberately does not exist before this call.
    for (let launch = 0; launch < 2; launch++) {
      const result = spawnSync('/bin/sh', [resolve('snap/local/k1vpn-launch'), 'argument with spaces'], {
        env: { ...process.env, SNAP: snap, XDG_RUNTIME_DIR: runtime, TMPDIR: '/tmp' }, encoding: 'utf8'
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe(`${runtime}\nargument with spaces\n`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
