import { useCallback, useEffect, useState } from 'react'
import type {
  PersonaDetailV1,
  PersonaSummaryV1,
  VersionComparisonV1,
} from '@echocue/contracts'
import { useServiceState } from '../hooks/useServiceState'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { EmptyState, LoadingState } from '../components/StateViews'
import { aliasText, formatVersion, parseAliases } from '../persona/persona-logic'

export default function PersonaPage() {
  const serviceState = useServiceState()
  const [members, setMembers] = useState<PersonaSummaryV1[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PersonaDetailV1 | null>(null)
  const [draftText, setDraftText] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [comparison, setComparison] = useState<VersionComparisonV1 | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const reloadList = useAsyncAction(async () => {
    const list = await window.echocue.persona.list()
    setMembers(list)
    if (selectedId !== null && !list.some((p) => p.personaId === selectedId)) {
      setSelectedId(null)
      setDetail(null)
    }
    return true
  })

  const loadDetail = useAsyncAction(async (personaId: string) => {
    const next = await window.echocue.persona.get(personaId)
    setDetail(next)
    setDraftText(next.editableContent)
    setAliasInput(aliasText(next.aliases))
    setPreviewing(false)
    setComparison(null)
    return true
  })

  useEffect(() => {
    void reloadList.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedId !== null) void loadDetail.run(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const select = useCallback((personaId: string) => setSelectedId(personaId), [])

  const addMember = useAsyncAction(async () => {
    const created = await window.echocue.persona.create({ displayName: '新成员' })
    await reloadList.run()
    setSelectedId(created.personaId)
    setMessage('已新增成员')
    return true
  })

  const setPrincipal = useAsyncAction(async (personaId: string) => {
    await window.echocue.persona.setPrincipal(personaId)
    await reloadList.run()
    await loadDetail.run(personaId)
    setMessage('已设为主要出镜')
    return true
  })

  const remove = useAsyncAction(async (personaId: string) => {
    await window.echocue.persona.delete(personaId)
    setSelectedId(null)
    setDetail(null)
    // Clear edit buffers so the fallback selection never shows the deleted
    // member's content or writes it into another member.
    setDraftText('')
    setAliasInput('')
    setComparison(null)
    await reloadList.run()
    setMessage('已删除成员')
    return true
  })

  const canEditSelected = detail !== null && detail.summary.personaId === selectedId

  const saveDraft = useAsyncAction(async () => {
    if (selectedId === null || !canEditSelected) return false
    await window.echocue.persona.saveDraft({ personaId: selectedId, content: draftText })
    await loadDetail.run(selectedId)
    setMessage('草稿已保存')
    return true
  })

  const publish = useAsyncAction(async () => {
    if (!detail) return false
    const latestDraft = detail.versions.find((v) => v.status === 'DRAFT')
    if (!latestDraft) {
      setMessage('没有可发布的草稿')
      return false
    }
    if (!window.confirm('发布后将作为该成员的当前人设，确定发布？')) return false
    await window.echocue.persona.publish(latestDraft.personaVersion)
    await loadDetail.run(detail.summary.personaId)
    setMessage(
      serviceState && serviceState.lifecycle !== 'STOPPED'
        ? '已发布；将在下次启动服务时生效'
        : '已发布',
    )
    return true
  })

  const rollback = useAsyncAction(async (fromVersion: string) => {
    if (selectedId === null || !canEditSelected) return false
    await window.echocue.persona.saveDraft({ personaId: selectedId, fromVersion })
    await loadDetail.run(selectedId)
    setMessage('已基于所选版本创建新草稿')
    return true
  })

  const compare = useAsyncAction(async (a: string, b: string) => {
    const result = await window.echocue.persona.compare(a, b)
    setComparison(result)
    return true
  })

  const saveAliases = useAsyncAction(async () => {
    if (selectedId === null || !canEditSelected) return false
    await window.echocue.persona.updateAliases(selectedId, parseAliases(aliasInput))
    await loadDetail.run(selectedId)
    setMessage('别名已保存')
    return true
  })

  if (members === null) {
    return reloadList.error ? (
      <EmptyState
        title="团队与人设"
        description={reloadList.error}
        action={<button type="button" onClick={() => void reloadList.run()}>重试</button>}
      />
    ) : (
      <LoadingState label="正在读取成员…" />
    )
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="团队与人设"
        description="尚未添加成员。请先新增成员，系统会自动将第一名成员设为主要出镜。"
        action={
          <button type="button" onClick={() => void addMember.run()}>
            新增成员
          </button>
        }
      />
    )
  }

  const selected = members.find((p) => p.personaId === selectedId) ?? members[0] ?? null
  const activeDetail = detail && detail.summary.personaId === selected?.personaId ? detail : null
  // listVersions is ASC by created_at; createDraft appends a new row, so the
  // latest draft is the last DRAFT in the array.
  const latestDraft = activeDetail
    ? [...activeDetail.versions].reverse().find((v) => v.status === 'DRAFT') ?? null
    : null
  const activeVersion = activeDetail?.versions.find((v) => v.status === 'PUBLISHED') ?? null

  const busy =
    reloadList.running || loadDetail.running || saveDraft.running || publish.running || saveAliases.running
  const error =
    reloadList.error ??
    loadDetail.error ??
    saveDraft.error ??
    publish.error ??
    addMember.error ??
    setPrincipal.error ??
    remove.error ??
    rollback.error ??
    compare.error ??
    saveAliases.error

  return (
    <section>
      <div className="page-heading">
        <h2>团队与人设</h2>
        <p>维护成员、别名与版本化自然语言人设；发布版本供实时服务使用。</p>
      </div>

      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}

      <div className="split">
        <div className="member-list">
          {members.map((p) => (
            <button
              key={p.personaId}
              type="button"
              className={p.personaId === selected?.personaId ? 'selected' : undefined}
              onClick={() => select(p.personaId)}
            >
              {p.isPrincipal ? '● ' : ''}
              {p.displayName}
              <small>
                {p.isPrincipal ? '主要出镜' : p.activeVersion ? `已发布 v${p.versionCount}` : '尚未发布'}
              </small>
            </button>
          ))}
          <button type="button" className="secondary" onClick={() => void addMember.run()}>
            新增成员
          </button>
        </div>

        <div className="card grow">
          {selected ? (
            <>
              <div className="page-heading">
                <h2>{selected.displayName}</h2>
                <div className="button-row">
                  {!selected.isPrincipal ? (
                    <button type="button" className="secondary" onClick={() => void setPrincipal.run(selected.personaId)}>
                      设为主要出镜
                    </button>
                  ) : (
                    <span className="badge success">主要出镜</span>
                  )}
                  <button
                    type="button"
                    className="danger"
                    disabled={selected.isPrincipal}
                    title={selected.isPrincipal ? '请先指定另一名主要出镜' : undefined}
                    onClick={() => void remove.run(selected.personaId)}
                  >
                    删除成员
                  </button>
                </div>
              </div>

              <label>
                匹配名称 / 昵称（用逗号或顿号分隔）
                <input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                />
              </label>
              <button type="button" className="secondary" disabled={busy} onClick={() => void saveAliases.run()}>
                保存别名
              </button>

              <label>
                人设内容
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button type="button" disabled={busy} onClick={() => void saveDraft.run()}>
                  保存草稿
                </button>
                <button type="button" className="secondary" onClick={() => setPreviewing((v) => !v)}>
                  {previewing ? '收起预览' : '预览'}
                </button>
                {latestDraft ? (
                  <button type="button" className="secondary" disabled={busy} onClick={() => void publish.run()}>
                    发布此版本
                  </button>
                ) : null}
              </div>
              {previewing ? <div className="preview-box">{draftText || '（空）'}</div> : null}

              {activeDetail ? (
                <div className="section-title">
                  <h2>版本历史</h2>
                  <div className="version-list">
                    {activeDetail.versions.map((v) => (
                      <button
                        key={v.personaVersion}
                        type="button"
                        onClick={() =>
                          void compare.run(v.personaVersion, activeVersion?.personaVersion ?? v.personaVersion)
                        }
                      >
                        {formatVersion(v)}
                        <small>{v.personaVersion.slice(0, 8)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {comparison ? (
                <div className="preview-box">
                  <b>
                    版本对比 {comparison.a.personaVersion.slice(0, 8)} ↔{' '}
                    {comparison.b.personaVersion.slice(0, 8)}
                  </b>
                  <p>{comparison.sameContent ? '内容一致' : '内容不同'}</p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void rollback.run(comparison.a.personaVersion)}
                  >
                    基于所选版本创建草稿
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
