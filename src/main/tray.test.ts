import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKING_SNAPSHOT } from '../shared/connectionHealth'

const mock = vi.hoisted(() => ({
  setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn(),
  create: vi.fn(), on: vi.fn(), destroy: vi.fn(), menu: vi.fn()
}))
vi.mock('electron', () => {
  const image = {
    resize: vi.fn().mockReturnThis(), isEmpty: () => false,
    toBitmap: () => Buffer.alloc(64 * 64 * 4)
  }
  return {
    nativeImage: { createFromPath: () => image, createFromBitmap: () => ({ ...image }) },
    Tray: class {
      constructor(icon: unknown) { mock.create(icon) }
      setImage = mock.setImage
      setToolTip = mock.setToolTip
      setContextMenu = mock.setContextMenu
      on = mock.on
      destroy = mock.destroy
    },
    Menu: { buildFromTemplate: mock.menu.mockImplementation((items) => items) }
  }
})
import { AppTray } from './tray'

const actions = { open: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), quit: vi.fn(), error: vi.fn() }
beforeEach(() => vi.clearAllMocks())

describe('tray registration and menu', () => {
  it('keeps the initial icon stable during registration and unrelated health updates', () => {
    const tray = new AppTray('icon.png', CHECKING_SNAPSHOT, actions)
    tray.setLanguage('el')
    tray.update({ ...CHECKING_SNAPSHOT, revision: 1 })
    expect(mock.create).toHaveBeenCalledOnce()
    expect(mock.setImage).not.toHaveBeenCalled()
    tray.update({ ...CHECKING_SNAPSHOT, display: 'disconnected' })
    expect(mock.setImage).toHaveBeenCalledOnce()
    tray.update({ ...CHECKING_SNAPSHOT, display: 'disconnected', publicIp: { ip: '203.0.113.1', countryCode: null, countryName: null } })
    expect(mock.setImage).toHaveBeenCalledOnce()
  })

  it('shows readable status/IP rows with a color marker and opens details', () => {
    new AppTray('icon.png', { ...CHECKING_SNAPSHOT, display: 'protected', ipState: 'ready', publicIp: { ip: '203.0.113.1', countryCode: null, countryName: null } }, actions)
    const items = mock.menu.mock.lastCall![0]
    expect(items[0].label).toBe('🟢 VPN connected')
    expect(items[1].label).toBe('IP: 203.0.113.1')
    for (const item of items.slice(0, 2)) {
      expect(item.enabled).not.toBe(false)
      item.click()
    }
    expect(actions.open).toHaveBeenCalledTimes(2)
  })

  it.each(['connect', 'disconnect'] as const)('activates the window before %s from the desktop menu', (action) => {
    const order: string[] = []
    const handlers = {
      ...actions,
      open: vi.fn(() => { order.push('open') }),
      [action]: vi.fn(async () => { order.push(action) })
    }
    new AppTray('icon.png', { ...CHECKING_SNAPSHOT, display: 'disconnected' }, handlers)
    const items = mock.menu.mock.lastCall![0]
    items[action === 'connect' ? 4 : 5].click()
    expect(order).toEqual(['open', action])
    expect(handlers[action]).toHaveBeenCalledOnce()
  })

})
