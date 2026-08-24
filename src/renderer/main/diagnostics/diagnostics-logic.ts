import type { DiagnosticSummaryV1, SessionMetricsSnapshotV1 } from '@echocue/contracts'

// UI §8.1 capacity display: human-readable GiB/MiB without a fractional tail.
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes) || bytes < 0) return '暂无'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`
  return `${bytes} B`
}

// UI §8.1 timestamps: local "yyyy-MM-dd HH:mm:ss" (24h), never the raw ISO tail.
export function formatDateTime(iso: string | undefined | null): string {
  if (iso === undefined || iso === null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// E2E latency (UI §8.1): exactly two decimals, trailing zeros kept.
export function formatE2eMs(ms: number): string {
  return `${ms.toFixed(2)} ms`
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

// WP-1 monitoring section (补充九): every displayed value uses a Chinese label,
// never the raw prometheus metric name.
const SEMANTIC_TYPE_LABELS: Record<string, string> = {
  persona_relevant: '人设相关',
  positive_praise: '正向夸奖',
  funny_joke: '趣味调侃',
  interactive_question: '互动提问',
  atmosphere_boost: '氛围助推',
  low_value: '低价值',
  filter_risk: '过滤风险',
}

export function localizeSemanticType(type: string): string {
  return SEMANTIC_TYPE_LABELS[type] ?? type
}

// Session range for the monitoring header: "start … end" or "运行中" when live.
export function formatSessionRange(snapshot: SessionMetricsSnapshotV1): string {
  if (snapshot.sessionId === undefined) return '暂无直播会话'
  const start = formatDateTime(snapshot.startedAt)
  if (snapshot.endedAt === undefined) return `${start} 起 · 运行中`
  return `${start} ～ ${formatDateTime(snapshot.endedAt)}`
}

export interface MonitoringRow {
  label: string
  value: string
}

// The business-first monitoring grid (补充九): danmaku, LLM and display counts
// front and center; latencies in ms.
export function buildMonitoringRows(snapshot: SessionMetricsSnapshotV1): MonitoringRow[] {
  const rows: MonitoringRow[] = [
    { label: '捕获弹幕数', value: `${snapshot.commentReceived}` },
    { label: '过滤弹幕数', value: `${snapshot.commentFiltered}` },
    { label: '成功展示数', value: `${snapshot.displayed}` },
    { label: '丢弃数', value: `${snapshot.discarded}` },
    { label: '失败数', value: `${snapshot.failed}` },
    { label: 'LLM 调用次数', value: `${snapshot.llmRequests}` },
    {
      label: 'LLM 平均时延',
      value: snapshot.llmAvgLatencyMs === undefined ? '暂无' : `${snapshot.llmAvgLatencyMs.toFixed(0)} ms`,
    },
    {
      label: '端到端 P95',
      value: snapshot.e2eP95Ms === undefined ? '暂无' : `${snapshot.e2eP95Ms.toFixed(0)} ms`,
    },
  ]
  return rows
}

export function semanticTypeEntries(snapshot: SessionMetricsSnapshotV1): Array<[string, number]> {
  return Object.entries(snapshot.semanticTypeCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
}

// Desensitized summary for copy (FR-09 / UI §8.1): lifecycle, activity and
// anonymized metrics only — never comment text, persona text, keys or trace ids.
export function buildCopyableSummary(summary: DiagnosticSummaryV1): string {
  const receivedAt = formatDateTime(summary.lastCommentReceivedAt)
  const suggestionAt = formatDateTime(summary.lastSuggestionAt)
  const lines = [
    `运行状态：${summary.lifecycle} / ${summary.activity}`,
    `最近接收弹幕：${receivedAt === '' ? '暂无' : receivedAt}`,
    `最近建议结果：${localizeSuggestionResult(summary.lastSuggestionResult)}${suggestionAt === '' ? '' : `（${suggestionAt}）`}`,
    summary.lastE2eLatencyMs === undefined
      ? '最近端到端耗时：暂无'
      : `最近端到端耗时：${formatE2eMs(summary.lastE2eLatencyMs)}`,
    `审计存储可用：${formatBytes(summary.storageAvailableBytes)}${summary.storageLowSpace === true ? '（低空间预警 E_STORAGE_LOW）' : ''}`,
    summary.lastDomainError === undefined
      ? '最近领域错误：无'
      : `最近领域错误：${summary.lastDomainError}`,
  ]
  return lines.join('\n')
}
