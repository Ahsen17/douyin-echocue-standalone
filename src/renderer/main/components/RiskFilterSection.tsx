import { useEffect, useState } from 'react'
import { useAsyncAction } from '../hooks/useAsyncAction'
import {
  newRiskTypeId,
  toRiskDrafts,
  validateRiskDrafts,
  validateRiskKeyword,
  type RiskTypeDraft,
} from '../risk-filter/risk-filter-logic'

// 直播设置页「风险过滤」面板：用户自定义风险类型与关键词；未配置时运行期不做风险过滤。
export default function RiskFilterSection() {
  const [drafts, setDrafts] = useState<RiskTypeDraft[]>([])
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const config = await window.echocue.config.get()
    setDrafts(toRiskDrafts(config.riskFilter.types))
    setKeywordInputs({})
    setLoaded(true)
    setMessage(null)
    setFieldError(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useAsyncAction(async () => {
    const validation = validateRiskDrafts(drafts)
    if (!validation.ok) {
      setFieldError(validation.message)
      setMessage(null)
      return false
    }
    await window.echocue.config.update({ riskFilter: { types: validation.types } })
    setDrafts(toRiskDrafts(validation.types))
    setKeywordInputs({})
    setFieldError(null)
    setMessage('已保存；风险过滤将在下次启动服务时生效')
    return true
  })

  if (!loaded) {
    return load.error ? <p className="danger-text">{load.error}</p> : <p className="muted">正在读取风险过滤配置…</p>
  }

  const addType = () => {
    const typeId = newRiskTypeId()
    setDrafts((current) => [...current, { typeId, label: '', keywords: [] }])
    setKeywordInputs((current) => ({ ...current, [typeId]: '' }))
    setFieldError(null)
  }

  const removeType = (typeId: string) => {
    setDrafts((current) => current.filter((d) => d.typeId !== typeId))
    setFieldError(null)
  }

  const updateLabel = (typeId: string, label: string) => {
    setDrafts((current) => current.map((d) => (d.typeId === typeId ? { ...d, label } : d)))
    setFieldError(null)
  }

  const addKeyword = (typeId: string) => {
    const raw = keywordInputs[typeId] ?? ''
    const type = drafts.find((d) => d.typeId === typeId)
    if (!type) return
    const error = validateRiskKeyword(raw, type.keywords)
    if (error !== null) {
      setFieldError(error)
      return
    }
    setDrafts((current) =>
      current.map((d) => (d.typeId === typeId ? { ...d, keywords: [...d.keywords, raw.trim()] } : d)),
    )
    setKeywordInputs((current) => ({ ...current, [typeId]: '' }))
    setFieldError(null)
  }

  const removeKeyword = (typeId: string, keyword: string) => {
    setDrafts((current) =>
      current.map((d) => (d.typeId === typeId ? { ...d, keywords: d.keywords.filter((k) => k !== keyword) } : d)),
    )
    setFieldError(null)
  }

  const error = load.error ?? save.error
  const busy = save.running || load.running

  return (
    <div className="card">
      <h2>风险过滤</h2>
      <p>自定义风险类型与关键词；运行时弹幕、AI 输出与 pre_set 导入都按此配置过滤。未配置类型时默认不进行风险过滤。</p>

      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}
      {fieldError ? <p className="danger-text">{fieldError}</p> : null}

      {drafts.length === 0 ? (
        <p className="muted">未配置风险类型时，默认不进行风险过滤。</p>
      ) : (
        drafts.map((type) => (
          <section key={type.typeId} className="card">
            <div className="row">
              <label>
                类型名称
                <input
                  type="text"
                  value={type.label}
                  placeholder="如 隐私信息"
                  maxLength={40}
                  onChange={(e) => updateLabel(type.typeId, e.target.value)}
                />
              </label>
              <button type="button" className="danger" onClick={() => removeType(type.typeId)}>
                删除类型
              </button>
            </div>
            <div>
              <b>关键词</b>
              <div className="tag-list">
                {type.keywords.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    className="tag"
                    title="删除"
                    onClick={() => removeKeyword(type.typeId, keyword)}
                  >
                    {keyword} ×
                  </button>
                ))}
              </div>
              <div className="inline-add">
                <input
                  type="text"
                  value={keywordInputs[type.typeId] ?? ''}
                  placeholder="新增关键词，回车添加"
                  maxLength={40}
                  onChange={(e) => {
                    setKeywordInputs((current) => ({ ...current, [type.typeId]: e.target.value }))
                    setFieldError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addKeyword(type.typeId)
                    }
                  }}
                />
                <button type="button" onClick={() => addKeyword(type.typeId)}>
                  添加
                </button>
              </div>
            </div>
          </section>
        ))
      )}

      <div className="button-row">
        <button type="button" className="secondary" disabled={busy} onClick={addType}>
          新增类型
        </button>
        <button type="button" disabled={busy} onClick={() => void save.run()}>
          {save.running ? '正在保存…' : '保存风险过滤'}
        </button>
      </div>
      <small>保存后下次启动服务时生效（会话内冻结）。</small>
    </div>
  )
}
