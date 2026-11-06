import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('sandboxed preload', () => {
  it('is emitted as CommonJS under the name the main process loads', () => {
    const config = readFileSync('electron.vite.config.ts', 'utf8')
    const main = readFileSync('src/main/index.ts', 'utf8')
    expect(config).toMatch(/format: 'cjs', entryFileNames: '\[name\]\.cjs'/)
    expect(main).toContain("join(__dirname, '../preload/index.cjs')")
    expect(main).toContain('sandbox: true')
  })
})
