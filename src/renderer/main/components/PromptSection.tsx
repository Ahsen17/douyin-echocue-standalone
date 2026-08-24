import { useEffect, useState } from 'react'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { EmptyState } from './StateViews'

// 系统设置页「提示词」面板（原独立提示词设置页，UI §2 重构并入）。
export default function PromptSection() {
  const [custom, setCustom] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [version, setVersion] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const config = await window.echocue.config.get()
    setCustom(config.prompt?.systemPromptTemplate ?? null)
    setDraft(config.prompt?.systemPromptTemplate ?? '')
    setVersion(config.prompt?.templateVersion ?? null)
    setUpdatedAt(config.prompt?.updatedAt ?? null)
    setLoaded(true)
    setMessage(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useAsyncAction(async () => {
    await window.echocue.config.update({ systemPrompt: draft })
    await load.run()
    setMessage(draft.trim() === '' ? '已恢复为代码默认提示词' : '提示词已保存，将在下次启动服务时生效')
    return true
  })

  const restoreDefault = useAsyncAction(async () => {
    setDraft('')
    await window.echocue.config.update({ systemPrompt: '' })
    await load.run()
    setMessage('已恢复为代码默认提示词')
    return true
  })

  if (!loaded) {
    return load.error ? (
      <EmptyState
        title="提示词设置"
        description={load.error}
        action={
          <button type="button" onClick={() => void load.run()}>
            重试
          </button>
        }
      />
    ) : (
      <p className="muted">正在读取提示词配置…</p>
    )
  }

  const error = load.error ?? save.error ?? restoreDefault.error
  const busy = load.running || save.running || restoreDefault.running

  return (
    <section className="card">
      <p className="muted">自定义 LLM 生成建议的系统级提示词；user 部分（弹幕 / 人设 / 禁忌 / 检索数据）始终由应用组装。</p>

      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}

      <div className="button-row">
        <span className="badge">{custom === null ? '正在使用代码默认提示词' : '自定义模板生效中'}</span>
        {custom !== null ? (
          <small className="muted">
            模板版本 {version} · 更新于 {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}
          </small>
        ) : null}
      </div>

      <label>
        系统级提示词（system prompt）
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={20000}
          placeholder="留空并使用代码默认提示词；填写后保存将替换指令部分。"
          style={{ minHeight: 240 }}
        />
      </label>

      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void save.run()}>
          保存提示词
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || custom === null}
          onClick={() => void restoreDefault.run()}
        >
          恢复默认
        </button>
      </div>

      <p className="muted">
        硬性规则（只输出 JSON、字段约束、安全边界等）始终追加在模板之后，不会被配置移除；提示词在服务启动时生效。
      </p>
    </section>
  )
}
