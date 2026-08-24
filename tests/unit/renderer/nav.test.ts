import { describe, it, expect } from 'vitest'
import { NAV_ITEMS, isNavItem } from '../../../src/renderer/main/nav.js'
import { NAV_ICONS } from '../../../src/renderer/main/components/NavIcon.js'
import {
  LIVE_SETTINGS_TABS,
  SYSTEM_SETTINGS_TABS,
} from '../../../src/renderer/main/pages/settings-tabs.js'

describe('main-window navigation', () => {
  it('exposes exactly the five official entries', () => {
    expect(NAV_ITEMS).toEqual([
      '服务运行',
      '直播设置',
      '系统设置',
      '监控诊断',
      '审计追溯',
    ])
  })

  it('does not include the overlay page as a nav entry', () => {
    expect(NAV_ITEMS).not.toContain('直播浮窗')
    expect(NAV_ITEMS.some((item) => item.includes('直播浮窗'))).toBe(false)
  })

  it('isNavItem narrows valid page names', () => {
    expect(isNavItem('服务运行')).toBe(true)
    expect(isNavItem('审计追溯')).toBe(true)
    expect(isNavItem('运行')).toBe(false)
    expect(isNavItem('直播间')).toBe(false)
    expect(isNavItem('直播浮窗')).toBe(false)
    expect(isNavItem('未知')).toBe(false)
  })

  it('provides an icon for every nav entry', () => {
    for (const item of NAV_ITEMS) {
      const icon = NAV_ICONS[item]
      expect(icon, `missing icon for ${item}`).toBeDefined()
      expect(icon.paths.length).toBeGreaterThan(0)
      for (const path of icon.paths) {
        expect(path.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('settings page tabs (five-page restructure)', () => {
  it('live settings aggregates room, personas, and safety', () => {
    expect(LIVE_SETTINGS_TABS).toEqual(['直播间', '团队与人设', '安全与禁忌'])
  })

  it('system settings aggregates provider, prompt, overlay, and runtime', () => {
    expect(SYSTEM_SETTINGS_TABS).toEqual(['AI 服务', '提示词', '浮窗偏好', '运行机制'])
  })
})
