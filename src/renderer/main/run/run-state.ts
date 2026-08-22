import type { ConfigViewV1, PersonaSummaryV1, ServiceViewState } from '@echocue/contracts'

export type RunAction = 'start' | 'stop' | 'retry' | 'view-diagnostics' | 'none'

export type RunTone = 'neutral' | 'warning' | 'success' | 'danger'

export interface RunStateView {
  label: string
  detail?: string
  tone: RunTone
  primaryAction: RunAction
  primaryLabel: string
  /** start is unavailable; e.g. audit down or config incomplete. */
  startDisabled?: boolean
  /** Show the overlay-preferences link alongside the primary action (DISPLAYING). */
  showPreferencesLink?: boolean
}

// UI §4 lifecycle/activity → text mapping. The renderer never derives lifecycle
// on its own; it only translates the ServiceViewState it receives.
export function deriveRunState(state: ServiceViewState, configComplete: boolean): RunStateView {
  if (!configComplete) {
    return {
      label: '需要完成基础配置后才能启动服务',
      tone: 'warning',
      primaryAction: 'start',
      primaryLabel: '启动服务',
      startDisabled: true,
    }
  }

  const { lifecycle, activity, stopReason, recoverableError } = state
  if (lifecycle === 'GATE_CONNECTING') {
    return { label: '正在确认直播状态', tone: 'warning', primaryAction: 'stop', primaryLabel: '停止' }
  }
  if (lifecycle === 'RUNNING') {
    if (activity === 'DISPLAYING') {
      return {
        label: '正在展示建议',
        tone: 'success',
        primaryAction: 'stop',
        primaryLabel: '停止',
        showPreferencesLink: true,
      }
    }
    if (activity === 'RETRIEVING' || activity === 'GENERATING') {
      return { label: '正在准备建议', tone: 'success', primaryAction: 'stop', primaryLabel: '停止' }
    }
    return { label: '正在监听', tone: 'success', primaryAction: 'stop', primaryLabel: '停止' }
  }

  // STOPPED: audit-unavailable is surfaced even when the gate failed with
  // E_AUDIT_UNAVAILABLE (stopReason SOURCE_ERROR + recoverableError).
  const auditDown = stopReason === 'AUDIT_UNAVAILABLE' || recoverableError?.code === 'E_AUDIT_UNAVAILABLE'
  if (auditDown) {
    return {
      label: '审计存储不可用',
      tone: 'danger',
      primaryAction: 'view-diagnostics',
      primaryLabel: '查看诊断',
      startDisabled: true,
    }
  }
  if (stopReason === 'ROOM_OFFLINE' || stopReason === 'ROOM_ENDED' || stopReason === 'SOURCE_ERROR') {
    return { label: '未启动；可手动重试', tone: 'warning', primaryAction: 'retry', primaryLabel: '重试启动' }
  }
  return { label: '已停止', tone: 'neutral', primaryAction: 'start', primaryLabel: '启动服务' }
}

export type MissingConfigItem = 'room' | 'ai' | 'principal'

export interface ConfigCompleteness {
  complete: boolean
  missing: MissingConfigItem[]
}

// 完成配置清单 (UI §4 first-run): 直播间、主要出镜人设、AI 服务配置.
export function computeConfigCompleteness(
  config: ConfigViewV1,
  personas: PersonaSummaryV1[],
): ConfigCompleteness {
  const missing: MissingConfigItem[] = []
  if (!config.roomReference) missing.push('room')
  if (!config.provider || !config.apiKeyConfigured) missing.push('ai')
  const hasPrincipalPublished = personas.some((p) => p.isPrincipal && p.activeVersion !== null)
  if (!hasPrincipalPublished) missing.push('principal')
  return { complete: missing.length === 0, missing }
}
