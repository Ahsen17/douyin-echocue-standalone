// Main-window navigation entries (UI §2). The overlay is an independent Electron
// window, never a main-nav entry.
export const NAV_ITEMS = [
  '运行',
  '直播间',
  '团队与人设',
  '安全与禁忌',
  '浮窗偏好',
  '诊断',
  '审计追溯',
] as const

export type PageName = (typeof NAV_ITEMS)[number]

export function isNavItem(value: string): value is PageName {
  return (NAV_ITEMS as readonly string[]).includes(value)
}
