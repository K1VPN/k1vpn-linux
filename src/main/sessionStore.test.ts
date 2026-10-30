import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SignedOutStore } from './sessionStore'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function setup(): Promise<{ path: string; store: SignedOutStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'k1vpn-session-'))
  directories.push(directory)
  const path = join(directory, 'signed-out')
  return { path, store: new SignedOutStore(path) }
}

describe('SignedOutStore', () => {
  it('defaults to permitting restore, then persists explicit state', async () => {
    const { store } = await setup()
    expect(store.get()).toBe(false)
    store.set(true)
    expect(store.get()).toBe(true)
    store.set(false)
    expect(store.get()).toBe(false)
  })

  it('fails closed on malformed state', async () => {
    const { path, store } = await setup()
    await writeFile(path, 'maybe')
    expect(store.get()).toBe(true)
  })
})
