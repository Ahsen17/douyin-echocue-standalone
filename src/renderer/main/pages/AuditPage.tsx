import { useEffect, useState } from 'react'
import type {
  AuditSearchResponseV1,
  AuditTraceSummaryV1,
  AuditWorkflowV1,
  LabelStatus,
  TraceFinalState,
} from '@echocue/contracts'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { ErrorState, LoadingState } from '../components/StateViews'
import {
  buildTimeline,
  defaultRevisionCount,
  extractSuggestionFromWorkflow,
  localizeFinalState,
  localizeLabelStatus,
  pageCount,
  resolveSelectedRow,
  shortTime,
} from '../audit/audit-logic'

const PAGE_SIZE = 20

export default function AuditPage() {
  const [authorized, setAuthorized] = useState(false)
  const [result, setResult] = useState<AuditSearchResponseV1 | null>(null)
  const [page, setPage] = useState(1)
  const [finalState, setFinalState] = useState<TraceFinalState | ''>('')
  const [labelStatus, setLabelStatus] = useState<LabelStatus | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workflow, setWorkflow] = useState<AuditWorkflowV1 | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)

  const search = useAsyncAction(async (nextPage: number, nextFinal: TraceFinalState | '', nextLabel: LabelStatus | '') => {
    const res = await window.echocue.audit.search({
      page: nextPage,
      pageSize: PAGE_SIZE,
      finalState: nextFinal === '' ? undefined : nextFinal,
      labelStatus: nextLabel === '' ? undefined : nextLabel,
    })
    setResult(res)
    setPage(res.page)
    return true
  })

  const loadWorkflow = useAsyncAction(async (traceId: string) => {
    setWorkflowError(null)
    setWorkflow(null)
    const wf = await window.echocue.audit.getWorkflow({ traceId })
    setWorkflow(wf)
    return true
  })

  useEffect(() => {
    if (authorized) void search.run(1, '', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized])

  if (!authorized) {
    return (
      <div className="audit-page">
        <div className="page-heading">
          <h1>审计追溯</h1>
          <span className="badge">本机加密 · 永久保存 · 不可导出</span>
        </div>
        <section className="card privacy-notice">
          <h2>本机审计访问提示</h2>
          <p>此处包含直播审计原文，请仅由获授权配置人员在本机查看。MVP 不提供导出或清空。</p>
          <button type="button" onClick={() => setAuthorized(true)}>
            我已获授权，进入审计
          </button>
        </section>
      </div>
    )
  }

  if (search.error !== null) {
    return (
      <div className="audit-page">
        <ErrorState code="E_AUDIT_QUERY" message={search.error} onRetry={() => void search.run(page, finalState, labelStatus)} />
      </div>
    )
  }
  if (search.running && result === null) {
    return (
      <div className="audit-page">
        <LoadingState label="正在查询并按需解密详情…" />
      </div>
    )
  }
  if (result === null) {
    return (
      <div className="audit-page">
        <LoadingState label="正在查询并按需解密详情…" />
      </div>
    )
  }

  const items = result.items
  // Derive the selected row fresh from the page each render so a label save
  // (which re-runs search) surfaces the updated labelStatus/revisionCount; when
  // the selected trace leaves the page, fall back to an empty state rather than
  // showing another trace's workflow/label (错行打标防护).
  const selectedRow = resolveSelectedRow(items, selectedId)
  const totalPages = pageCount(result.total, result.pageSize)

  const applyFilters = (nextFinal: TraceFinalState | '', nextLabel: LabelStatus | '') => {
    setFinalState(nextFinal)
    setLabelStatus(nextLabel)
    void search.run(1, nextFinal, nextLabel)
  }

  const openRow = (row: AuditTraceSummaryV1) => {
    setSelectedId(row.traceId)
    setWorkflow(null)
    setWorkflowError(null)
    void loadWorkflow.run(row.traceId)
  }

  return (
    <div className="audit-page">
      <div className="page-heading">
        <div>
          <h1>审计追溯</h1>
          <p>完整 workflow 与主观打标是同一工作区的两个入口。</p>
        </div>
        <span className="badge">本机加密 · 永久保存 · 不可导出</span>
      </div>

      <section className="card filters">
        <label>
          处理结果
          <select value={finalState} onChange={(e) => applyFilters(e.target.value as TraceFinalState | '', labelStatus)}>
            <option value="">全部</option>
            <option value="HIDDEN">已展示后隐藏</option>
            <option value="FILTERED">已过滤</option>
            <option value="FAILED">未生成</option>
            <option value="DISCARDED">展示前失效</option>
          </select>
        </label>
        <label>
          打标状态
          <select value={labelStatus} onChange={(e) => applyFilters(finalState, e.target.value as LabelStatus | '')}>
            <option value="">全部</option>
            <option value="UNLABELED">未打标</option>
            <option value="ACCEPTED">已认可</option>
            <option value="REJECTED">已拒绝</option>
            <option value="CORRECTED">已修正</option>
            <option value="NOT_APPLICABLE">无需打标</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => void search.run(page, finalState, labelStatus)}>
          查询
        </button>
      </section>

      {items.length === 0 ? (
        <section className="card empty-state">
          <b>没有匹配记录</b>
          <p>调整筛选条件后重试；不会自动清除历史审计。</p>
        </section>
      ) : (
        <div className="audit-body">
          <section className="card audit-list">
            <h2>审计记录</h2>
            {items.map((row) => (
              <button
                type="button"
                key={row.traceId}
                className={row.traceId === selectedRow?.traceId ? 'selected' : ''}
                onClick={() => openRow(row)}
              >
                <small>
                  {shortTime(row.receivedAt)} · {localizeFinalState(row.finalState)}
                </small>
                <strong>{row.commentText || '（无正文快照）'}</strong>
                <span>{localizeLabelStatus(row.labelStatus)}</span>
              </button>
            ))}
            <div className="pager">
              <button
                type="button"
                className="secondary"
                disabled={page <= 1}
                onClick={() => void search.run(page - 1, finalState, labelStatus)}
              >
                上一页
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page >= totalPages}
                onClick={() => void search.run(page + 1, finalState, labelStatus)}
              >
                下一页
              </button>
            </div>
          </section>

          <section className="card grow audit-detail">
            {selectedRow === null ? (
              <div className="empty-state">
                <b>选择一条记录查看详情</b>
              </div>
            ) : (
              <>
                <h2>记录详情 · {shortTime(selectedRow.receivedAt)}</h2>
                <DetailTabs
                  key={selectedRow.traceId}
                  row={selectedRow}
                  workflow={workflow}
                  workflowLoading={loadWorkflow.running}
                  workflowError={workflowError}
                  onLabelSaved={() => void search.run(page, finalState, labelStatus)}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function DetailTabs({ row, workflow, workflowLoading, workflowError, onLabelSaved }: {
  row: AuditTraceSummaryV1
  workflow: AuditWorkflowV1 | null
  workflowLoading: boolean
  workflowError: string | null
  onLabelSaved: (status: LabelStatus) => void
}) {
  const [tab, setTab] = useState<'workflow' | 'label'>('workflow')
  return (
    <>
      <div className="tabs">
        <button type="button" className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>
          工作流上下文
        </button>
        <button type="button" className={tab === 'label' ? 'active' : ''} onClick={() => setTab('label')}>
          {row.labelStatus === 'UNLABELED' ? '进入打标' : '查看 / 编辑打标'}
        </button>
      </div>
      {tab === 'workflow' ? (
        <WorkflowPanel workflow={workflow} loading={workflowLoading} error={workflowError} />
      ) : (
        <LabelForm row={row} workflow={workflow} onSaved={onLabelSaved} />
      )}
    </>
  )
}

function WorkflowPanel({ workflow, loading, error }: {
  workflow: AuditWorkflowV1 | null
  loading: boolean
  error: string | null
}) {
  if (loading && workflow === null) return <LoadingState label="正在加载 workflow 上下文…" />
  if (error !== null) return <ErrorState code="E_AUDIT_READ" message={error} />
  if (workflow === null) return <div className="empty-state"><b>暂无 workflow 数据</b></div>
  const timeline = buildTimeline(workflow)
  return (
    <div className="workflow">
      {timeline.map((item) => (
        <section key={item.sequenceNo}>
          <div className="transition-head">
            <span className="reason-badge">{item.reasonCode}</span>
            <small>
              {shortTime(item.occurredAt)} · {item.stateLabel}
            </small>
          </div>
          {item.snapshots.map((snap) => (
            <details key={snap.snapshotId}>
              <summary>
                {snap.role} · {snap.contentType}
              </summary>
              <pre>{snap.plaintext}</pre>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}

function LabelForm({ row, workflow, onSaved }: {
  row: AuditTraceSummaryV1
  workflow: AuditWorkflowV1 | null
  onSaved: (status: LabelStatus) => void
}) {
  const [approve, setApprove] = useState(true)
  const [corrected, setCorrected] = useState(false)
  const [score, setScore] = useState('85')
  const [reply, setReply] = useState('')
  const [cues, setCues] = useState('')
  const [saved, setSaved] = useState<LabelStatus | null>(row.labelStatus === 'UNLABELED' ? null : row.labelStatus)

  const submit = useAsyncAction(async () => {
    // A checked-but-empty correction is a plain rejection (UI §8.2): without a
    // non-empty reply the label must never be recorded as CORRECTED/ACCEPTED.
    const hasCorrection = corrected && reply.trim() !== ''
    const isRejected = !approve && !hasCorrection
    const res = await window.echocue.audit.submitLabel({
      traceId: row.traceId,
      expectedRevisionNo: defaultRevisionCount(row),
      score: isRejected ? 0 : Number(score),
      correctedQuickReply: hasCorrection ? reply.trim() : undefined,
      correctedCues: hasCorrection ? cues.split(/[，,·\s]+/).filter(Boolean) : undefined,
    })
    setSaved(res.labelStatus)
    onSaved(res.labelStatus)
    return true
  })

  if (!row.hasSuggestion) {
    return (
      <div className="empty-state">
        <b>无需打标</b>
        <p>本条没有最终建议，仅可查看 workflow 上下文。</p>
      </div>
    )
  }
  if (saved !== null && !submit.error) {
    return (
      <div className="label-summary">
        <b>当前打标：{localizeLabelStatus(saved)}</b>
        <p>已保存为当前有效打标；再次编辑会产生新修订，不覆盖历史。</p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => setSaved(null)}>
            编辑本次打标
          </button>
        </div>
      </div>
    )
  }

  const suggestion = extractSuggestionFromWorkflow(workflow)

  return (
    <div className="label-form">
      {suggestion !== null ? (
        <div className="ai-suggestion">
          <b>AI 建议回复</b>
          <p>{suggestion.quickReply}</p>
          {suggestion.cues.length > 0 ? <small>提词：{suggestion.cues.join(' · ')}</small> : null}
        </div>
      ) : null}
      <p><b>为本条最终建议打标</b></p>
      <label className="choice">
        <input type="radio" checked={approve} onChange={() => setApprove(true)} /> 认可建议
      </label>
      <label className="choice">
        <input type="radio" checked={!approve} onChange={() => setApprove(false)} /> 不认可建议
      </label>
      {approve ? (
        <label>
          主观质量分（0–100）
          <input type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
      ) : (
        <>
          <p>原建议将记为 0 分。</p>
          <label className="checkbox">
            <input type="checkbox" checked={corrected} onChange={(e) => setCorrected(e.target.checked)} />
            填写主播认为更好的答案
          </label>
          {corrected && (
            <>
              <label>
                更优短回复
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} />
              </label>
              <label>
                提词（2–3 条，用逗号或顿号分隔）
                <input value={cues} onChange={(e) => setCues(e.target.value)} />
              </label>
              <label>
                修正答案质量分（默认 85）
                <input type="number" min="1" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
              </label>
            </>
          )}
        </>
      )}
      {submit.running && <p className="inline-message" role="status">正在保存打标…</p>}
      {submit.error !== null && <p className="inline-message danger-text" role="alert">{submit.error}</p>}
      <div className="button-row">
        <button
          type="button"
          disabled={
            submit.running ||
            (approve && Number(score) <= 0) ||
            (corrected && (reply.trim() === '' || cues.trim() === ''))
          }
          onClick={() => void submit.run()}
        >
          保存打标
        </button>
      </div>
      <small>这里只显示用户可理解的打标状态，不显示案例库、阈值或同步机制。</small>
    </div>
  )
}
