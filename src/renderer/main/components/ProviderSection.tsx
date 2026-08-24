import { useEffect, useState } from 'react'
import { DEEPSEEK_DEFAULT_BASE_URL, type ConfigViewV1, type ConnectionTestResultV1 } from '@echocue/contracts'
import { useServiceState } from '../hooks/useServiceState'
import { useAsyncAction } from '../hooks/useAsyncAction'
import {
  OFFERABLE_ADAPTERS,
  initialForm,
  validateProviderForm,
  type ProviderForm,
} from '../provider/provider-form'
import { saveProviderConfig } from '../provider/provider-save'

const TEST_RESULT_LABELS: Record<ConnectionTestResultV1['status'], string> = {
  OK: '配置有效',
  AUTH_FAILED: '认证失败',
  UNAVAILABLE: '服务暂不可用',
}

// 系统设置页「AI 服务」卡片：provider 表单（与直播间标识解耦，直播间在直播设置页）。
export default function ProviderSection() {
  const serviceState = useServiceState()
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState<ConfigViewV1 | null>(null)
  const [form, setForm] = useState<ProviderForm>({
    displayName: '',
    adapterType: 'OPENAI_COMPATIBLE',
    baseUrl: '',
    modelId: '',
    apiKey: '',
  })
  const [message, setMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ConnectionTestResultV1['status'] | null>(null)

  const saveAction = useAsyncAction(async () => {
    const validation = validateProviderForm(form)
    if (!validation.ok) {
      setFieldError(validation.message)
      return false
    }
    setFieldError(null)
    const updated = await saveProviderConfig(
      {
        configUpdate: (input) => window.echocue.config.update(input),
        setApiKey: (providerId, apiKey) => window.echocue.provider.setApiKey(providerId, apiKey),
      },
      { form },
    )
    setConfig(updated)
    setForm((f) => ({ ...f, apiKey: '' }))
    // Conservative: when the service state is not known to be STOPPED, the new
    // config applies on the next service start.
    const running = !serviceState || serviceState.lifecycle !== 'STOPPED'
    setMessage(running ? '已保存；将在下次启动服务时生效' : '已保存')
    return true
  })

  const testAction = useAsyncAction(async () => {
    const result = await window.echocue.provider.testConnection()
    setTestResult(result.status)
  })

  const clearKeyAction = useAsyncAction(async () => {
    if (!window.confirm('确定清除已保存的 API Key 吗？清除后需重新输入。')) return false
    await window.echocue.provider.clearApiKey(config?.provider?.providerId ?? '')
    setConfig((c) => (c ? { ...c, apiKeyConfigured: false } : c))
    setMessage('已清除 API Key')
    return true
  })

  useEffect(() => {
    let cancelled = false
    void window.echocue.config.get().then((view) => {
      if (cancelled) return
      setConfig(view)
      setForm(initialForm(view))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loaded) {
    return <p className="muted">正在读取 AI 服务配置…</p>
  }

  const error = saveAction.error ?? testAction.error ?? clearKeyAction.error
  const busy = saveAction.running || testAction.running || clearKeyAction.running

  return (
    <div className="card">
      <h2>AI 服务</h2>
      <div className="form-grid">
        <label>
          服务商名称<span className="opt-hint">选填 · 不填则用默认名</span>
          <input
            type="text"
            value={form.displayName}
            placeholder="如 DeepSeek"
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          />
        </label>
        <label>
          适配器类型<span className="req-mark">*</span>
          <select
            value={form.adapterType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                adapterType: e.target.value as ProviderForm['adapterType'],
              }))
            }
          >
            {OFFERABLE_ADAPTERS.map((adapter) => (
              <option key={adapter} value={adapter}>
                {adapter}
              </option>
            ))}
          </select>
        </label>
        <label>
          Base URL
          {form.adapterType === 'OPENAI_COMPATIBLE' ? (
            <span className="req-mark">*</span>
          ) : (
            <span className="opt-hint">选填 · 已内置 {DEEPSEEK_DEFAULT_BASE_URL}，可留空</span>
          )}
          <input
            type="text"
            value={form.baseUrl}
            placeholder={form.adapterType === 'DEEPSEEK' ? 'https://api.deepseek.com' : 'https://api.example.com'}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
          />
        </label>
        <label>
          Model ID<span className="req-mark">*</span>
          <input
            type="text"
            value={form.modelId}
            placeholder="模型标识"
            onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
          />
        </label>
        <label>
          API Key<span className="req-mark">*</span>
          <input
            type="password"
            value={form.apiKey}
            placeholder={config?.apiKeyConfigured ? '已配置；输入新值可替换，留空则保留原 Key' : '请输入 API Key'}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          />
        </label>
      </div>

      {fieldError ? <p className="danger-text">{fieldError}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}
      {error ? <p className="danger-text">{error}</p> : null}
      {testResult ? (
        <p className="inline-message">连接测试：{TEST_RESULT_LABELS[testResult]}</p>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => void testAction.run()}
        >
          {testAction.running ? '正在测试连接…' : '测试连接'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void saveAction.run()}
        >
          {saveAction.running ? '正在保存…' : '保存配置'}
        </button>
        {config?.apiKeyConfigured ? (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void clearKeyAction.run()}
          >
            清除 API Key
          </button>
        ) : null}
      </div>
      <p>API Key 只显示「已配置」状态，绝不回显。</p>
    </div>
  )
}
