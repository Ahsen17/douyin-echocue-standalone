import type { DiagnosticSummaryV1 } from '@echocue/contracts'

// UI §8.1 capacity display: human-readable GiB/MiB without a fractional tail.
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes) || bytes < 0) return '暂无'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`
  return `${bytes} B`
}

const RESULT_LABELS: Record<NonNullable<DiagnosticSummaryV1['lastSuggestionResult']>, string> = {
  displayed: '已展示后隐藏',
  filtered: '已过滤',
  discarded: '未生成',
  failed: '生成失败',
}

const ERROR_HINTS: Partial<Record<NonNullable<DiagnosticSummaryV1['lastDomainError']>, string>> = {
  E_STORAGE_LOW: '本机存储空间不足，可能影响后续直播。不会自动删除审计，请释放其他文件或扩容。',
  E_AUDIT_UNAVAILABLE: '审计存储不可用，请处理后重新启动。',
  E_SOURCE_UNAVAILABLE: '无法连接直播弹幕服务，请检查后手动重试。',
  E_QDRANT_UNAVAILABLE: '本地检索服务不可用，请重试。',
  E_ROOM_OFFLINE: '直播间尚未开播，请稍后手动启动。',
}

export function localizeSuggestionResult(result: DiagnosticSummaryV1['lastSuggestionResult']): string {
  return result === undefined ? '暂无' : RESULT_LABELS[result]
}

export function localizeDomainError(code: DiagnosticSummaryV1['lastDomainError']): string | null {
  if (code === undefined) return null
  return ERROR_HINTS[code] ?? '最近一次运行遇到错误，请查看诊断与日志。'
}

// Desensitized summary for copy (FR-09 / UI §8.1): lifecycle, activity and
// anonymized metrics only — never comment text, persona text, keys or trace ids.
export function buildCopyableSummary(summary: DiagnosticSummaryV1): string {
  const lines = [
    `运行状态：${summary.lifecycle} / ${summary.activity}`,
    `最近接收弹幕：${summary.lastCommentReceivedAt ?? '暂无'}`,
    `最近建议结果：${localizeSuggestionResult(summary.lastSuggestionResult)}${summary.lastSuggestionAt ? `（${summary.lastSuggestionAt}）` : ''}`,
    summary.lastE2eLatencyMs === undefined
      ? '最近端到端耗时：暂无'
      : `最近端到端耗时：${summary.lastE2eLatencyMs} ms`,
    `审计存储可用：${formatBytes(summary.storageAvailableBytes)}${summary.storageLowSpace === true ? '（低空间预警 E_STORAGE_LOW）' : ''}`,
    summary.lastDomainError === undefined
      ? '最近领域错误：无'
      : `最近领域错误：${summary.lastDomainError}`,
  ]
  return lines.join('\n')
}
