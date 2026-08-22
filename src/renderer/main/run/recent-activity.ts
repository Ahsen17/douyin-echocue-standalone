import type { DiagnosticSummaryV1 } from '@echocue/contracts'

export interface RecentActivityView {
  lastReceived: string
  lastProcessed: string
  lastE2eMs: string
}

const RESULT_LABELS: Record<NonNullable<DiagnosticSummaryV1['lastSuggestionResult']>, string> = {
  displayed: '已展示',
  filtered: '已过滤',
  discarded: '已丢弃',
  failed: '失败',
}

function formatTime(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

// 最近活动卡 (UI §4): only anonymous fields cross this boundary.
export function formatRecentActivity(summary: DiagnosticSummaryV1): RecentActivityView {
  const receivedTime = formatTime(summary.lastCommentReceivedAt)
  const suggestionTime = formatTime(summary.lastSuggestionAt)
  const processedLabel = summary.lastSuggestionResult ? RESULT_LABELS[summary.lastSuggestionResult] : null

  return {
    lastReceived: receivedTime ?? '暂无',
    lastProcessed:
      suggestionTime !== null && processedLabel !== null
        ? `${processedLabel} · ${suggestionTime}`
        : '暂无',
    lastE2eMs: summary.lastE2eLatencyMs !== undefined ? `${summary.lastE2eLatencyMs} 毫秒` : '暂无',
  }
}
