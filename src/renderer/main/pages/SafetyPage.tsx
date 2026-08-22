import { useEffect, useState } from 'react'
import type { SafetyPolicyViewV1 } from '@echocue/contracts'
import { useServiceState } from '../hooks/useServiceState'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { EmptyState, LoadingState } from '../components/StateViews'
import {
  formatSafetyVersion,
  localizeErrors,
  validateKeyword,
  type LocalizedCompileError,
} from '../safety/safety-logic'

export default function SafetyPage() {
  const serviceState = useServiceState()
  const [view, setView] = useState<SafetyPolicyViewV1 | null>(null)
  const [policyText, setPolicyText] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [keywordError, setKeywordError] = useState<string | null>(null)
  const [compileErrors, setCompileErrors] = useState<LocalizedCompileError[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const next = await window.echocue.safety.get()
    setView(next)
    setPolicyText(next.current?.policyText ?? '')
    setKeywords(next.current?.keywords ?? [])
    setKeywordInput('')
    setKeywordError(null)
    setCompileErrors(
      next.current !== null && next.current.validationErrors.length > 0
        ? localizeErrors(next.current.validationErrors, next.current.policyText)
        : [],
    )
    setMessage(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addKeyword = () => {
    const error = validateKeyword(keywordInput, keywords)
    if (error !== null) {
      setKeywordError(error)
      return
    }
    setKeywords([...keywords, keywordInput.trim()])
    setKeywordInput('')
    setKeywordError(null)
  }

  const removeKeyword = (word: string) => {
    setKeywords(keywords.filter((k) => k !== word))
  }

  const validateAndPublish = useAsyncAction(async () => {
    // Error clause positions refer to the submitted text, not the live editor.
    const submittedText = policyText
    const result = await window.echocue.safety.saveDraft({
      policyText: submittedText,
      keywords,
    })
    if (!result.valid) {
      setCompileErrors(localizeErrors(result.errors, submittedText))
      setMessage(null)
      return true
    }
    await window.echocue.safety.publish(result.versionMeta.safetyPolicyVersion)
    setCompileErrors([])
    await load.run()
    setMessage(
      serviceState !== null && serviceState.lifecycle !== 'STOPPED'
        ? '已保存并发布；将在下次启动服务时生效'
        : '已保存并发布',
    )
    return true
  })

  if (view === null) {
    return load.error ? (
      <EmptyState
        title="安全与禁忌"
        description={load.error}
        action={<button type="button" onClick={() => void load.run()}>重试</button>}
      />
    ) : (
      <LoadingState label="正在读取安全策略…" />
    )
  }

  const error = load.error ?? validateAndPublish.error
  const busy = load.running || validateAndPublish.running
  const badge =
    compileErrors.length > 0
      ? { className: 'badge warning', text: '需修改' }
      : view.activeVersion !== null
        ? { className: 'badge success', text: `已发布 · ${formatSafetyVersion(view.activeVersion)}` }
        : { className: 'badge', text: '草稿待校验' }

  return (
    <section>
      <div className="page-heading">
        <h2>安全与禁忌</h2>
        <p>基础风险内容会在检索和 Provider 调用前忽略，不会形成回复建议。</p>
      </div>

      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}

      <div className="card">
        <label>
          团队边界说明
          <textarea
            value={policyText}
            placeholder="不要讨论成员的住址、感情状态与其他私密信息；禁止接住攻击、人身侮辱或挑衅性话题。"
            onChange={(e) => setPolicyText(e.target.value)}
          />
        </label>

        <div>
          <b>关键词 / 短语</b>
          {keywordError ? (
            <p className="inline-message danger-text" role="alert">
              {keywordError}
            </p>
          ) : null}
          <div className="tag-list">
            {keywords.map((word) => (
              <button
                key={word}
                type="button"
                className="tag"
                title="删除"
                onClick={() => removeKeyword(word)}
              >
                {word} ×
              </button>
            ))}
          </div>
          <div className="inline-add">
            <input
              type="text"
              value={keywordInput}
              placeholder="新增关键词"
              onChange={(e) => {
                setKeywordInput(e.target.value)
                setKeywordError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addKeyword()
                }
              }}
            />
            <button type="button" onClick={addKeyword}>
              添加
            </button>
          </div>
        </div>

        {compileErrors.length > 0 ? (
          <div role="alert">
            {compileErrors.map((err, index) => (
              <p key={index} className="inline-message danger-text">
                {err.message}
                {err.clause !== null ? `（${err.clause}）` : ''}
              </p>
            ))}
            <small>当前草稿未发布</small>
          </div>
        ) : null}

        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void validateAndPublish.run()}>
            校验并发布
          </button>
          <span className={badge.className}>{badge.text}</span>
        </div>
        <small>无法确定性解释的自然语言会逐条提示并阻止发布。</small>
      </div>
    </section>
  )
}
