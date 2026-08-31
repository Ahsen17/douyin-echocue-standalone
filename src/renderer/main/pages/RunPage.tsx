import { useEffect, useState } from 'react'
import type { ConfigViewV1, DiagnosticSummaryV1, PersonaSummaryV1 } from '@echocue/contracts'
import type { PageName, PageProps } from '../nav'
import { useServiceState } from '../hooks/useServiceState'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { LoadingState } from '../components/StateViews'
import RetrievalCard from '../components/RetrievalCard'
import {
  computeConfigCompleteness,
  deriveRunState,
  type MissingConfigItem,
  type RunAction,
} from '../run/run-state'
import { formatRecentActivity } from '../run/recent-activity'
import {
  thresholdFormFromConfig,
  validateThresholdForm,
  buildThresholdUpdate,
  type ThresholdForm,
} from '../run/thresholds'

const MISSING_CONFIG: Record<MissingConfigItem, { label: string; nav: PageName; tab?: string }> = {
  room: { label: '直播间', nav: '直播设置' },
  ai: { label: 'AI 服务配置', nav: '系统设置' },
  principal: { label: '主要出镜人设', nav: '直播设置', tab: '团队与人设' },
}

function ThresholdsCard({ config }: { config: ConfigViewV1 }) {
  const [form, setForm] = useState<ThresholdForm>(() => thresholdFormFromConfig(config))
  const [message, setMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const save = useAsyncAction(async () => {
    const validation = validateThresholdForm(form)
    if (!validation.ok) {
      setFieldError(validation.message)
      setMessage(null)
      return false
    }
    const updated = await window.echocue.config.update(
      buildThresholdUpdate(
        validation.directPush,
        validation.semanticDiscard,
        validation.preSet,
        validation.goldenSet,
      ),
    )
    setForm(thresholdFormFromConfig(updated))
    setFieldError(null)
    setMessage('已保存；将在下次启动服务时生效')
    return true
  })

  return (
    <div className="card">
      <h2>检索置信度阈值与校准参数</h2>
      <p>golden_set 命中达到直出阈值时跳过 LLM 直接展示；low_value / filter_risk 分类置信度达到语义丢弃阈值时直接丢弃（调高阈值更不易丢弃）。阈值范围 0–1；置信度由原始分经 sigmoid（center/scale）校准得到，pre_set 与 golden_set 各一组。</p>
      <div className="form-grid">
        <label>
          golden 直出阈值（默认 0.85）
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={form.directPush}
            onChange={(e) => {
              setForm((f) => ({ ...f, directPush: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
        <label>
          语义丢弃阈值（默认 0.9）
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={form.semanticDiscard}
            onChange={(e) => {
              setForm((f) => ({ ...f, semanticDiscard: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          pre_set 校准 center（默认 0）
          <input
            type="number"
            step="any"
            value={form.preSetCenter}
            onChange={(e) => {
              setForm((f) => ({ ...f, preSetCenter: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
        <label>
          pre_set 校准 scale（默认 2）
          <input
            type="number"
            min="0.01"
            step="any"
            value={form.preSetScale}
            onChange={(e) => {
              setForm((f) => ({ ...f, preSetScale: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
        <label>
          golden_set 校准 center（默认 0）
          <input
            type="number"
            step="any"
            value={form.goldenSetCenter}
            onChange={(e) => {
              setForm((f) => ({ ...f, goldenSetCenter: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
        <label>
          golden_set 校准 scale（默认 2）
          <input
            type="number"
            min="0.01"
            step="any"
            value={form.goldenSetScale}
            onChange={(e) => {
              setForm((f) => ({ ...f, goldenSetScale: e.target.value }))
              setFieldError(null)
            }}
          />
        </label>
      </div>
      {fieldError ? <p className="danger-text">{fieldError}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}
      {save.error ? <p className="danger-text">{save.error}</p> : null}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={save.running}
          onClick={() => void save.run()}
        >
          {save.running ? '正在保存…' : '保存阈值'}
        </button>
      </div>
    </div>
  )
}

export default function RunPage({ onNavigate }: PageProps) {
  const serviceState = useServiceState()
  const [config, setConfig] = useState<ConfigViewV1 | null>(null)
  const [personas, setPersonas] = useState<PersonaSummaryV1[]>([])
  const [summary, setSummary] = useState<DiagnosticSummaryV1 | null>(null)

  const reload = useAsyncAction(async () => {
    const [c, p, s] = await Promise.all([
      window.echocue.config.get(),
      window.echocue.persona.list(),
      window.echocue.diagnostics.getSummary(),
    ])
    setConfig(c)
    setPersonas(p)
    setSummary(s)
  })
  useEffect(() => {
    void reload.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startAction = useAsyncAction(() => window.echocue.service.start())
  const stopAction = useAsyncAction(() => window.echocue.service.stop())

  const completeness = config ? computeConfigCompleteness(config, personas) : null
  const runView = serviceState ? deriveRunState(serviceState, completeness?.complete ?? false) : null
  const activity = summary ? formatRecentActivity(summary) : null

  const principal = personas.find((p) => p.isPrincipal)

  function handlePrimary(action: RunAction): void {
    switch (action) {
      case 'start':
      case 'retry':
        void startAction.run()
        break
      case 'stop':
        void stopAction.run()
        break
      case 'view-diagnostics':
        onNavigate('监控诊断')
        break
    }
  }

  const actionError = startAction.error ?? stopAction.error ?? reload.error

  if (!serviceState || !runView) {
    return <LoadingState label="正在读取服务状态…" />
  }

  const buttonClass = runView.tone === 'danger' || runView.primaryAction === 'stop' ? 'danger' : undefined

  return (
    <section>
      <div className="page-heading">
        <h2>服务运行</h2>
        <p>当前直播间 {config?.roomReference ?? '未设置'} · 团队 {personas.length} 人 · 主要出镜{' '}
          {principal?.displayName ?? '未设置'}</p>
      </div>

      <div className={`card status ${runView.tone}`}>
        <b>● {runView.label}</b>
        {runView.detail ? <p>{runView.detail}</p> : null}
        {actionError ? <p className="danger-text">{actionError}</p> : null}
        <button
          type="button"
          className={buttonClass}
          disabled={
            (runView.primaryAction === 'start' || runView.primaryAction === 'retry'
              ? runView.startDisabled
              : false) ||
            startAction.running ||
            stopAction.running
          }
          onClick={() => handlePrimary(runView.primaryAction)}
        >
          {runView.primaryLabel}
        </button>
      </div>

      {config !== null ? <ThresholdsCard config={config} /> : null}

      <RetrievalCard serviceLifecycle={serviceState.lifecycle} onNavigate={onNavigate} />

      {completeness && !completeness.complete ? (
        <div className="card">
          <h2>完成配置</h2>
          <p>启动服务前需要完成以下配置：</p>
          <ul>
            {completeness.missing.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onNavigate(MISSING_CONFIG[item].nav, MISSING_CONFIG[item].tab)}
                >
                  {MISSING_CONFIG[item].label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {activity ? (
        <div className="metrics compact">
          <div>
            <strong>最近接收</strong>
            <small>{activity.lastReceived}</small>
          </div>
          <div>
            <strong>最近处理</strong>
            <small>{activity.lastProcessed}</small>
          </div>
          <div>
            <strong>端到端耗时</strong>
            <small>{activity.lastE2eMs}</small>
          </div>
          <div>
            <strong>当前活动</strong>
            <small>{serviceState.activity}</small>
          </div>
        </div>
      ) : null}
    </section>
  )
}
