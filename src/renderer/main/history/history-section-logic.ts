export const HISTORY_MIN_ENTRIES = 1
export const HISTORY_MAX_ENTRIES = 120
export const HISTORY_DEFAULT_ENTRIES = 20

// 系统设置「历史窗口」保留条数上限校验；返回错误文案或 null。
export function validateMaxEntries(n: number): string | null {
  if (!Number.isInteger(n) || n < HISTORY_MIN_ENTRIES || n > HISTORY_MAX_ENTRIES) {
    return `条数上限需在 ${HISTORY_MIN_ENTRIES}–${HISTORY_MAX_ENTRIES} 之间`
  }
  return null
}
