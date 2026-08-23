import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PreSetImportResultV1, RetrievalInitStatusV1, ServiceViewState } from '@echocue/contracts'
import type { PageProps } from '../nav'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { deriveRetrievalBlock, describeImportFailure } from '../run/retrieval-state'

const MAX_PRE_SET_BYTES = 20 * 1024 * 1024 // PRESET §1 single-package limit

interface RetrievalCardProps {
  serviceLifecycle: ServiceViewState['lifecycle']
  onNavigate: PageProps['onNavigate']
}

// 运行页「检索初始化」卡片（RUNBOOK §3.1 step 5）。只在停服态允许导入；
// 展示 profile 摘要与错误码，绝不展示案例原文。
export default function RetrievalCard({ serviceLifecycle, onNavigate }: RetrievalCardProps) {
  const [status, setStatus] = useState<RetrievalInitStatusV1 | null>(null)
  const [result, setResult] = useState<PreSetImportResultV1 | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canImport = serviceLifecycle === 'STOPPED'

  const refresh = useAsyncAction(async () => {
    setStatus(await window.echocue.retrieval.getStatus())
  })
  const importAction = useAsyncAction(async (content: string) => {
    const r = await window.echocue.retrieval.importPreSet(content)
    setResult(r)
    if (r.ok) await refresh.run()
  })

  // Refresh on mount and after every lifecycle change so a stop re-surfaces the
  // current retrieval state (e.g. gate failing on E_QDRANT_UNAVAILABLE).
  useEffect(() => {
    void refresh.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceLifecycle])

  const block = deriveRetrievalBlock(status, refresh.running)
  // Poll while the sidecar is not ready (cold start can exceed mount time) so a
  // slow Qdrant boot does not leave the card stuck on a stale "unavailable".
  const blockRef = useRef(block)
  blockRef.current = block
  const refreshRunRef = useRef(refresh.run)
  refreshRunRef.current = refresh.run
  useEffect(() => {
    const id = setInterval(() => {
      const current = blockRef.current
      if (current.kind === 'unavailable' || current.kind === 'needs-import') {
        void refreshRunRef.current()
      }
    }, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFileChange(file: File | undefined): void {
    if (!file) return
    if (file.size > MAX_PRE_SET_BYTES) {
      setFileName(`${file.name}（超过 20 MiB 上限，未选择）`)
      setFileContent(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : null
      setFileContent(content)
      setFileName(content !== null ? file.name : null)
    }
    reader.onerror = () => {
      setFileContent(null)
      setFileName(null)
    }
    reader.readAsText(file)
  }

  const importArea = block.kind !== 'loading' && block.kind !== 'unavailable'

  return (
    <div className="card">
      <h2>检索初始化</h2>
      {block.kind === 'loading' ? <p>正在读取检索状态…</p> : null}
      {block.kind === 'unavailable' ? (
        <>
          <p className="danger-text">检索服务不可用，导入与启动前请先检查 Qdrant 状态。</p>
          <button type="button" className="secondary" onClick={() => onNavigate('诊断')}>
            查看诊断
          </button>
        </>
      ) : null}
      {block.kind === 'needs-import' ? (
        <p>检索库未初始化：导入 pre_set 数据后即可启动服务。</p>
      ) : null}
      {block.kind === 'ready' ? (
        <p>
          检索库已就绪
          {block.profileId ? `（profile ${block.profileId.slice(0, 8)}…）` : ''}
        </p>
      ) : null}
      {importArea ? (
        <>
          <div className="row">
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.json,application/jsonl,text/plain"
              disabled={!canImport}
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            {fileContent !== null ? (
              <button
                type="button"
                disabled={!canImport || importAction.running}
                onClick={() => void importAction.run(fileContent)}
              >
                {importAction.running ? '导入中…' : '导入 pre_set 数据'}
              </button>
            ) : null}
          </div>
          {!canImport ? <p className="muted">服务运行中，需先停止服务后才能导入。</p> : null}
          {fileName ? <p className="muted">已选择：{fileName}</p> : null}
          {importAction.error ? <p className="danger-text">{importAction.error}</p> : null}
          {result ? renderResult(result) : null}
        </>
      ) : null}
    </div>
  )
}

function renderResult(result: PreSetImportResultV1): ReactNode {
  if (result.ok) {
    return (
      <p className="success-text">
        已导入 {result.entryCount} 条（profile {result.profile.profileId.slice(0, 8)}…）
      </p>
    )
  }
  const failure = describeImportFailure(result.errors, result.truncated)
  return (
    <div className="danger-text">
      <p>整体导入失败：{failure.total} 处错误{failure.truncated ? '（仅显示前几条）' : ''}，未创建检索库。</p>
      <ul>
        {failure.samples.map((sample, i) => (
          <li key={i}>{sample}</li>
        ))}
      </ul>
    </div>
  )
}
