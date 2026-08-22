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
  // Optimistic lock baseline: revision count the page observed. A loaded summary
  // that is UNLABELED starts from 0; labeled rows start at 1 (one revision).
  if (summary === null) return 0
  return summary.labelStatus === 'UNLABELED' ? 0 : 1
}
