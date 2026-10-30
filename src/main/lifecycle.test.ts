import { describe, expect, it, vi } from 'vitest'
import { QuitController } from './lifecycle'

function setup() {
  const deps = {
    confirm: vi.fn(async () => true),
    disconnect: vi.fn(async (): Promise<unknown> => undefined),
    status: vi.fn(async (): Promise<unknown> => ({ state: 'disconnected', recovery_required: false })),
    quit: vi.fn()
  }
  return { deps, controller: new QuitController(deps) }
}

describe('safe desktop exit', () => {
  it('exits at once for the session or snapd, without a dialog or a disconnect', () => {
    const { controller, deps } = setup()
    controller.exitNow()
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.disconnect).not.toHaveBeenCalled()
    expect(deps.quit).toHaveBeenCalledOnce()
    expect(controller.allowed).toBe(true)
  })

  it('confirms, disconnects and verifies cleanup before exiting', async () => {
    const { controller, deps } = setup()
    await controller.request()
    expect(deps.confirm).toHaveBeenCalledOnce()
    expect(deps.disconnect).toHaveBeenCalledOnce()
    expect(deps.status).toHaveBeenCalledOnce()
    expect(deps.quit).toHaveBeenCalledOnce()
    expect(controller.allowed).toBe(true)
    expect(deps.disconnect.mock.invocationCallOrder[0]).toBeLessThan(deps.status.mock.invocationCallOrder[0])
    expect(deps.status.mock.invocationCallOrder[0]).toBeLessThan(deps.quit.mock.invocationCallOrder[0])
  })

  it('leaves the tunnel and app alone when confirmation is cancelled', async () => {
    const { controller, deps } = setup()
    deps.confirm.mockResolvedValue(false)
    await controller.request()
    expect(deps.disconnect).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
    expect(controller.busy).toBe(false)
    expect(controller.allowed).toBe(false)
  })

  it('shares one request across simultaneous exit paths', async () => {
    const { controller, deps } = setup()
    let confirm!: (value: boolean) => void
    deps.confirm.mockImplementation(() => new Promise(resolve => { confirm = resolve }))
    const first = controller.request()
    const second = controller.request()
    expect(controller.busy).toBe(true)
    expect(second).toBe(first)
    confirm(true)
    await first
    expect(deps.disconnect).toHaveBeenCalledOnce()
    expect(deps.quit).toHaveBeenCalledOnce()
  })

  it('keeps the app running after a failed disconnect, and allows retry', async () => {
    const { controller, deps } = setup()
    deps.disconnect.mockRejectedValueOnce(new Error('daemon unavailable'))
    await expect(controller.request()).rejects.toThrow('daemon unavailable')
    expect(deps.quit).not.toHaveBeenCalled()
    expect(controller.allowed).toBe(false)
    expect(controller.busy).toBe(false)
    await controller.request()
    expect(deps.quit).toHaveBeenCalledOnce()
  })

  it.each([
    null, {}, { state: 'connected', recovery_required: false },
    { state: 'disconnected', recovery_required: true }, { state: 'disconnected' }
  ])('rejects an unconfirmed cleanup: %j', async (status) => {
    const { controller, deps } = setup()
    deps.status.mockResolvedValue(status)
    await expect(controller.request()).rejects.toThrow('could not be confirmed')
    expect(deps.quit).not.toHaveBeenCalled()
    expect(controller.allowed).toBe(false)
  })
})
