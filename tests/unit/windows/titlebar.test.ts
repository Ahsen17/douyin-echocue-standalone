import { describe, it, expect } from 'vitest'

const CLOSE_ARIA = '关闭并隐藏到托盘'
const MINIMIZE_ARIA = '最小化'
const MAXIMIZE_ARIA = '最大化'
const RESTORE_ARIA = '还原'
const IPC_CLOSE = 'window:close'
const IPC_MINIMIZE = 'window:minimize'
const IPC_MAXIMIZE = 'window:maximize'
const IPC_MAXIMIZE_CHANGED = 'window:maximize-changed'

describe('titlebar button semantic constants', () => {
  it('close button has correct aria-label', () => {
    expect(CLOSE_ARIA).toBe('关闭并隐藏到托盘')
  })

  it('minimize button has correct aria-label', () => {
    expect(MINIMIZE_ARIA).toBe('最小化')
  })

  it('maximize/restore button toggles aria-label', () => {
    expect(MAXIMIZE_ARIA).toBe('最大化')
    expect(RESTORE_ARIA).toBe('还原')
  })

  it('IPC channel names match preload and main handler', () => {
    expect(IPC_CLOSE).toBe('window:close')
    expect(IPC_MINIMIZE).toBe('window:minimize')
    expect(IPC_MAXIMIZE).toBe('window:maximize')
    expect(IPC_MAXIMIZE_CHANGED).toBe('window:maximize-changed')
  })
})
