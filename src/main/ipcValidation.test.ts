import { describe, expect, it } from 'vitest'
import { parseLanguage, parseLoginInput } from './ipcValidation'

describe('IPC argument validation', () => {
  it('accepts the exact login envelope', () => {
    expect(parseLoginInput({ username: 'user', password: 'secret', remember: true })).toEqual({ username: 'user', password: 'secret', remember: true })
  })
  it.each([null, [], {}, { username: 'u', password: 'p', remember: 1 }, { username: 'u', password: 'p', remember: false, extra: true }])('rejects malformed login input', (value) => {
    expect(() => parseLoginInput(value)).toThrow(TypeError)
  })
  it('accepts only supported languages', () => {
    expect(parseLanguage('el')).toBe('el')
    expect(parseLanguage('en')).toBe('en')
    expect(() => parseLanguage('de')).toThrow(TypeError)
  })
})
