import type {
  AuditTraceSummaryV1,
  AuditWorkflowV1,
  LabelStatus,
  TraceFinalState,
} from '@echocue/contracts'

// UI §8.2 结果筛选: final state → user-visible result label.
export const FINAL_STATE_LABELS: Record<TraceFinalState, string> = {
  HIDDEN: '已展示后隐藏',
  FILTERED: '已过滤',
  FAILED: '未生成',
  DISCARDED: '展示前失效',
}

export const LABEL_STATUS_LABELS: Record<LabelStatus, string> = {
  UNLABELED: '未打标',
  ACCEPTED: '已认可',
  REJECTED: '已拒绝',
  CORRECTED: '已修正',
  NOT_APPLICABLE: '无需打标',
}

export function localizeFinalState(finalState: TraceFinalState | null): string {
  return finalState === null ? '进行中' : FINAL_STATE_LABELS[finalState]
}

export function localizeLabelStatus(labelStatus: LabelStatus): string {
  return LABEL_STATUS_LABELS[labelStatus]
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function pageCount(total: number, pageSize: number): number {
  return total === 0 ? 1 : Math.ceil(total / pageSize)
}

export interface TimelineItem {
  sequenceNo: number
  stateLabel: string
  reasonCode: string
  occurredAt: string
  snapshots: AuditWorkflowV1['transitions'][number]['snapshots']
}

// Workflow timeline in sequence order; the detail panel renders one entry per
// transition and expands snapshots on demand (UI §8.2 按需解密/原文).
export function buildTimeline(workflow: AuditWorkflowV1): TimelineItem[] {
  return workflow.transitions.map((t) => ({
    sequenceNo: t.sequenceNo,
    stateLabel: t.toState,
    reasonCode: t.reasonCode,
    occurredAt: t.occurredAt,
    snapshots: t.snapshots,
  }))
}

export function defaultRevisionCount(summary: AuditTraceSummaryV1 | null): number {
  // Optimistic lock baseline: the exact revision count the page observed, so
  // edits keep succeeding after re-saves (audit.submitLabel rejects a mismatch).
  return summary?.revisionCount ?? 0
}

export interface WorkflowSuggestion {
  quickReply: string
  cues: string[]
}

// Pull the displayed suggestion out of the workflow (UI §8.2 打标旁直接可见)。
// The direct path records snake_case (DIRECT_PAYLOAD.quick_reply), the LLM path
// camelCase (LLM_PARSED_OUTPUT.quickReply); mirrors payload-builder.ts.
export function extractSuggestionFromWorkflow(
  workflow: AuditWorkflowV1 | null,
): WorkflowSuggestion | null {
  if (workflow === null) return null
  for (const transition of workflow.transitions) {
    for (const snapshot of transition.snapshots) {
      if (snapshot.contentType !== 'SUGGESTION_JSON') continue
      if (snapshot.role !== 'DIRECT_PAYLOAD' && snapshot.role !== 'LLM_PARSED_OUTPUT') continue
      const parsed = parseSuggestionJson(snapshot.plaintext)
      if (parsed !== null) return parsed
    }
  }
  return null
}

function parseSuggestionJson(plaintext: string): WorkflowSuggestion | null {
  try {
    const data = JSON.parse(plaintext) as {
      quick_reply?: unknown
      quickReply?: unknown
      cues?: unknown
    }
    const reply = typeof data.quick_reply === 'string' ? data.quick_reply : data.quickReply
    if (typeof reply !== 'string' || reply.length === 0) return null
    // Cues are optional: the label form must still show the AI reply when a
    // suggestion carries no cues (review M4).
    const cues = data.cues === undefined ? [] : data.cues
    if (!Array.isArray(cues)) return null
    if (!cues.every((c) => typeof c === 'string' && c.length > 0)) return null
    return { quickReply: reply, cues }
  } catch {
    return null
  }
}

// The detail panel must never silently jump to another row: when the selected
// trace is not on the current page (e.g. after a label save moves it out of a
// filter), return null so the panel shows an empty state instead of mismatched
// workflow/label state for a different trace.
export function resolveSelectedRow(
  items: readonly AuditTraceSummaryV1[],
  selectedId: string | null,
): AuditTraceSummaryV1 | null {
  if (selectedId === null) return items[0] ?? null
  return items.find((r) => r.traceId === selectedId) ?? null
}
