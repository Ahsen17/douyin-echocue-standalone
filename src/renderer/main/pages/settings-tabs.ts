// Tab entries inside the two aggregated settings pages (UI §2 restructure).
// Kept in a pure module so tests can assert the layout without React.
export const LIVE_SETTINGS_TABS = ['直播间', '团队与人设', '安全与禁忌', '风险过滤'] as const

export const SYSTEM_SETTINGS_TABS = ['AI 服务', '提示词', '浮窗偏好', '历史窗口', '运行机制'] as const

export type LiveSettingsTab = (typeof LIVE_SETTINGS_TABS)[number]
export type SystemSettingsTab = (typeof SYSTEM_SETTINGS_TABS)[number]
