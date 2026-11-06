import { describe, expect, it } from 'vitest'
import { isTrustedIpcSource } from './ipcPolicy'

function event(senderId: number, sameFrame = true): never {
  const mainFrame = {}
  return {
    sender: { id: senderId, mainFrame },
    senderFrame: sameFrame ? mainFrame : {}
  } as never
}

describe('main-process IPC policy', () => {
  it('accepts only the registered application main frame', () => {
    const trusted = new Set([7])
    expect(isTrustedIpcSource(event(7), trusted)).toBe(true)
    expect(isTrustedIpcSource(event(8), trusted)).toBe(false)
    expect(isTrustedIpcSource(event(7, false), trusted)).toBe(false)
  })
})
