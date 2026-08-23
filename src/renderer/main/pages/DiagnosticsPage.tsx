import { useEffect, useState } from 'react'
import type { CollectionCountsV1, DiagnosticSummaryV1 } from '@echocue/contracts'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { ErrorState, LoadingState } from '../components/StateViews'
import {
  buildCopyableSummary,
  formatBytes,
  formatDateTime,
  formatE2eMs,
  localizeDomainError,
  localizeSuggestionResult,
} from '../diagnostics/diagnostics-logic'

export default function DiagnosticsPage() {
  const [summary, setSummary] = useState<DiagnosticSummaryV1 | null>(null)
  const [counts, setCounts] = useState<CollectionCountsV1 | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useAsyncAction(async () => {
    const [next, nextCounts] = await Promise.all([
      window.echocue.diagnostics.getSummary(),
      window.echocue.retrieval.getCollectionCounts(),
    ])
    setSummary(next)
    setCounts(nextCounts)
    setCopied(false)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copySummary = async () => {
    if (summary === null) return
    try {
      await navigator.clipboard.writeText(buildCopyableSummary(summary))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (load.running && summary === null) {
    return <LoadingState label="正在刷新诊断摘要…" />
  }
  if (load.error !== null) {
    return <ErrorState code="E_DIAGNOSTICS_UNAVAILABLE" message={load.error} onRetry={() => void load.run()} />
  }
  if (summary === null) {
    return <LoadingState label="正在刷新诊断摘要…" />
  }

  const errorHint = localizeDomainError(summary.lastDomainError)
  const lowSpaceHint = summary.storageLowSpace === true
    ? '本机存储空间不足，可能影响后续直播。不会自动删除审计，请释放其他文件或扩容。'
    : null
  const metrics = [
    ['运行状态', `${summary.lifecycle} / ${summary.activity}`],
    ['最近接收弹幕', summary.lastCommentReceivedAt === undefined ? '暂无' : formatDateTime(summary.lastCommentReceivedAt)],
    ['最近建议结果', localizeSuggestionResult(summary.lastSuggestionResult)],
    ['最近端到端耗时', summary.lastE2eLatencyMs === undefined ? '暂无' : formatE2eMs(summary.lastE2eLatencyMs)],
    ['审计存储可用', formatBytes(summary.storageAvailableBytes)],
  ]

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>诊断</h1>
          <p>只显示脱敏健康信息。</p>
        </div>
        <div className="button-row">
          <button type="button" onClick={copySummary}>
            {copied ? '已复制脱敏诊断摘要' : '复制脱敏诊断摘要'}
          </button>
          <button type="button" className="secondary" onClick={() => void load.run()}>
            刷新
          </button>
        </div>
      </div>
      {lowSpaceHint !== null ? (
        <section className="card warning" role="alert">
          <b>E_STORAGE_LOW</b>
          <p>{lowSpaceHint}</p>
        </section>
      ) : null}
      {errorHint !== null ? (
        <section className="card warning" role="alert">
          <b>{summary.lastDomainError}</b>
          <p>{errorHint}</p>
        </section>
      ) : null}
      <section className="card">
        <b>● 链路健康</b>
        <p>链路摘要不展示弹幕原文、密钥或内部调用细节。</p>
      </section>
      <div className="metrics">
        {metrics.map(([label, value]) => (
          <section className="card" key={label}>
            <small>{label}</small>
            <h2>{value}</h2>
          </section>
        ))}
      </div>
      <section className="card">
        <b>● 检索库样本</b>
        <p>只显示两个本地集合的样本数量，用于确认 golden_set 回流是否成功，不展示案例内容。</p>
        <div className="metrics compact">
          <div>
            <small>pre_set 样本</small>
            <strong>{counts === null ? '…' : `${counts.preSetPointCount} 条`}</strong>
          </div>
          <div>
            <small>golden_set 样本</small>
            <strong>{counts === null ? '…' : `${counts.goldenSetPointCount} 条`}</strong>
          </div>
        </div>
      </section>
    </>
  )
}
