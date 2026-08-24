import type { ConfigUpdateRequestV1, ConfigViewV1 } from '@echocue/contracts'

export const DEFAULT_QUEUE_TIMEOUT_SEC = 30
export const DEFAULT_RETENTION_DAYS = 30
export const DEFAULT_METRICS_PORT = 9100

export interface RuntimeForm {
  queueingEnabled: boolean
  queueTimeoutSec: string
  retentionDays: string
  metricsPort: string
}

export type RuntimeValidation =
  | { ok: true; update: ConfigUpdateRequestV1 }
  | { ok: false; message: string }

export function runtimeFormFromConfig(view: ConfigViewV1): RuntimeForm {
  return {
    queueingEnabled: view.queueing.enabled,
    queueTimeoutSec: String(Math.round(view.queueing.timeoutMs / 1000)),
    retentionDays: String(view.audit.retentionDays),
    metricsPort: String(view.metrics.port),
  }
}

// 运行机制设置整卡一次保存（排队/保留期/metrics 端口）；与安全/提示词一样，
// 会话内冻结、下次启动服务时生效（metrics 端口重启应用后生效）。
// 排队关闭时超时字段被置灰，其残留文本不得阻塞无关保存——此时用 fallbackTimeoutSec
// （取上次存储值，恒合法）落盘，保证 QueueingConfigV1Schema.timeoutMs 始终在范围内。
export function validateRuntimeForm(
  form: RuntimeForm,
  fallbackTimeoutSec = 30,
): RuntimeValidation {
  const timeoutSec = form.queueingEnabled ? Number(form.queueTimeoutSec) : fallbackTimeoutSec
  if (form.queueingEnabled && (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 120)) {
    return { ok: false, message: '排队超时需为 1–120 之间的整数（秒）' }
  }
  const retentionDays = Number(form.retentionDays)
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 180) {
    return { ok: false, message: '审计保留天数需为 7–180 之间的整数' }
  }
  const metricsPort = Number(form.metricsPort)
  if (!Number.isInteger(metricsPort) || metricsPort < 1024 || metricsPort > 65535) {
    return { ok: false, message: 'metrics 端口需为 1024–65535 之间的整数' }
  }
  return {
    ok: true,
    update: {
      queueing: { enabled: form.queueingEnabled, timeoutMs: timeoutSec * 1000 },
      auditRetentionDays: retentionDays,
      metricsPort,
    },
  }
}
