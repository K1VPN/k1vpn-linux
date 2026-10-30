import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

let sequence = 0

export class SignedOutStore {
  constructor(private readonly path: string) {}

  get(): boolean {
    try {
      const value = readFileSync(this.path, 'utf8')
      return value === '1' ? true : value === '0' ? false : true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
  }

  set(value: boolean): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${++sequence}.tmp`
    try {
      writeFileSync(temporary, value ? '1' : '0', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      renameSync(temporary, this.path)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* exact temporary path only */ }
      throw error
    }
  }
}
