import type { PreSetImportErrorV1, RetrievalInitStatusV1 } from '@echocue/contracts'

// Run-page「检索初始化」卡片四态映射。renderer 不解析 Qdrant 细节，只翻译
// main 提供的 RetrievalInitStatusV1；import 结果仅展示 profile 摘要与错误码，
// 绝不展示案例原文。
export type RetrievalBlockState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'needs-import' }
  | { kind: 'ready'; profileId?: string; preSetSha256?: string }

export function deriveRetrievalBlock(
  status: RetrievalInitStatusV1 | null,
  loading: boolean,
): RetrievalBlockState {
  if (loading) return { kind: 'loading' }
  if (!status || !status.qdrantHealthy) return { kind: 'unavailable' }
  if (!status.ready) return { kind: 'needs-import' }
  return { kind: 'ready', profileId: status.profileId, preSetSha256: status.preSetSha256 }
}

export interface ImportFailureDisplay {
  total: number
  truncated: boolean
  samples: string[]
}

// Bounded, anonymized error lines for the UI: line/path/errorCode only, never
// the case text (importer already strips it before it reaches IPC).
export function describeImportFailure(
  errors: PreSetImportErrorV1[],
  truncated: boolean | undefined,
  sampleLimit = 5,
): ImportFailureDisplay {
  const samples = errors.slice(0, sampleLimit).map((e) => {
    const loc = e.path !== undefined ? `${e.path}` : e.line > 0 ? `第 ${e.line} 行` : ''
    const id = e.id !== undefined ? `（${e.id}）` : ''
    const body = `${loc}${id}`.trim()
    return body ? `${body} ${e.errorCode}` : e.errorCode
  })
  return { total: errors.length, truncated: truncated ?? false, samples }
}
