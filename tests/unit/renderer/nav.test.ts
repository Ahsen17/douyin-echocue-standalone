import { describe, it, expect } from 'vitest'
import { NAV_ITEMS, isNavItem } from '../../../src/renderer/main/nav.js'

describe('main-window navigation', () => {
  it('exposes exactly the seven official entries', () => {
    expect(NAV_ITEMS).toEqual([
      '运行',
      '直播间',
      '团队与人设',
      '安全与禁忌',
      '浮窗偏好',
      '诊断',
      '审计追溯',
    ])
  })

  it('does not include the overlay page as a nav entry', () => {
    expect(NAV_ITEMS).not.toContain('直播浮窗')
    expect(NAV_ITEMS.some((item) => item.includes('直播浮窗'))).toBe(false)
  })

  it('isNavItem narrows valid page names', () => {
    expect(isNavItem('运行')).toBe(true)
    expect(isNavItem('审计追溯')).toBe(true)
    expect(isNavItem('直播浮窗')).toBe(false)
    expect(isNavItem('未知')).toBe(false)
  })
})
