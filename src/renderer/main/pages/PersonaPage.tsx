import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PersonaDetailV1,
  PersonaSummaryV1,
  PersonaVersionMetaV1,
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
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  // View mode: the full text of the version being previewed (active published
  // by default). null when nothing is published yet.
  const [viewContent, setViewContent] = useState<string | null>(null)
  const [viewingVersion, setViewingVersion] = useState<PersonaVersionMetaV1 | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Latest selection mirror: stale async responses must not overwrite a newer
  // selection after a fast member switch (review M3).
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

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
    if (selectedIdRef.current !== personaId) return false
    setDetail(next)
    setDraftText(next.editableContent)
    setAliasInput(aliasText(next.aliases))
    // Default to the view mode: show the active published version's full text.
    setEditing(false)
    setViewingVersion(null)
    const active = next.versions.find((v) => v.status === 'PUBLISHED') ?? null
    if (active !== null) {
      const content = await window.echocue.persona.getVersionContent(personaId, active.personaVersion)
      if (selectedIdRef.current !== personaId) return false
      setViewContent(content.content)
    } else {
      setViewContent(null)
    }
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
    setDraftText('')
    setAliasInput('')
    setEditing(false)
    setViewContent(null)
    setViewingVersion(null)
    await reloadList.run()
    setMessage('已删除成员')
    return true
  })

  const canEditSelected = detail !== null && detail.summary.personaId === selectedId

  const enterEdit = () => {
    if (detail === null) return
    setDraftText(detail.editableContent)
    setAliasInput(aliasText(detail.aliases))
    setEditing(true)
  }

  const loadVersionView = useAsyncAction(async (version: PersonaVersionMetaV1) => {
    const personaId = selectedIdRef.current
    if (personaId === null) return false
    const content = await window.echocue.persona.getVersionContent(personaId, version.personaVersion)
    if (selectedIdRef.current !== personaId) return false
    setViewContent(content.content)
    setViewingVersion(version)
    return true
  })

  const saveDraft = useAsyncAction(async () => {
    if (selectedId === null || !canEditSelected) return false
    // 昵称随草稿一并保存（移除独立的「保存别名」操作）。
    await window.echocue.persona.updateAliases(selectedId, parseAliases(aliasInput))
    await window.echocue.persona.saveDraft({ personaId: selectedId, content: draftText })
    await loadDetail.run(selectedId)
    setMessage('草稿已保存')
    return true
  })

  const publish = useAsyncAction(async () => {
    if (selectedId === null || !canEditSelected) return false
    if (draftText.trim() === '') {
      setMessage('人设内容为空，无法发布')
      return false
    }
    if (!window.confirm('发布后将作为该成员的当前人设，确定发布？')) return false
    // 发布当前编辑器内容：无需先手动保存草稿。先存别名，再以当前正文创建
    // 草稿并立即发布，保证发布版本与编辑器一致。
    await window.echocue.persona.updateAliases(selectedId, parseAliases(aliasInput))
    const draft = await window.echocue.persona.saveDraft({ personaId: selectedId, content: draftText })
    await window.echocue.persona.publish(draft.personaVersion)
    await loadDetail.run(selectedId)
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
    enterEdit()
    setMessage('已基于所选版本创建新草稿')
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
  const activeVersion = activeDetail?.versions.find((v) => v.status === 'PUBLISHED') ?? null

  const busy =
    reloadList.running ||
    loadDetail.running ||
    saveDraft.running ||
    publish.running ||
    loadVersionView.running
  const error =
    reloadList.error ??
    loadDetail.error ??
    saveDraft.error ??
    publish.error ??
    addMember.error ??
    setPrincipal.error ??
    remove.error ??
    rollback.error ??
    loadVersionView.error

  return (
    <section>
      <div className="page-heading">
        <h2>团队与人设</h2>
        <p>维护成员、别名与版本化自然语言人设；先查看已发布内容，需要改动时再进入编辑。</p>
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
          {selected && activeDetail ? (
            editing ? (
              <EditForm
                displayName={selected.displayName}
                isPrincipal={selected.isPrincipal}
                canEdit={canEditSelected}
                draftText={draftText}
                aliasInput={aliasInput}
                busy={busy}
                onChangeDraft={setDraftText}
                onChangeAliases={setAliasInput}
                onSaveDraft={() => void saveDraft.run()}
                onPublish={() => void publish.run()}
                onCancel={() => setEditing(false)}
                onDelete={() => void remove.run(selected.personaId)}
                onSetPrincipal={() => void setPrincipal.run(selected.personaId)}
              />
            ) : (
              <ViewForm
                displayName={selected.displayName}
                isPrincipal={selected.isPrincipal}
                aliases={activeDetail.aliases}
                versions={activeDetail.versions}
                activeVersion={activeVersion}
                viewingVersion={viewingVersion}
                viewContent={viewContent}
                busy={busy}
                onEdit={enterEdit}
                onViewVersion={(v) => void loadVersionView.run(v)}
                onRollback={(v) => void rollback.run(v)}
                onDelete={() => void remove.run(selected.personaId)}
                onSetPrincipal={() => void setPrincipal.run(selected.personaId)}
              />
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ViewForm(props: {
  displayName: string
  isPrincipal: boolean
  aliases: PersonaDetailV1['aliases']
  versions: PersonaVersionMetaV1[]
  activeVersion: PersonaVersionMetaV1 | null
  viewingVersion: PersonaVersionMetaV1 | null
  viewContent: string | null
  busy: boolean
  onEdit: () => void
  onViewVersion: (v: PersonaVersionMetaV1) => void
  onRollback: (v: string) => void
  onDelete: () => void
  onSetPrincipal: () => void
}) {
  const shown = props.viewingVersion ?? props.activeVersion
  // Capture the viewed version for the rollback action (TS closure narrowing).
  const viewedVersion = props.viewingVersion
  const showRollback = viewedVersion !== null && viewedVersion.personaVersion !== props.activeVersion?.personaVersion
  return (
    <>
      <div className="page-heading">
        <h2>{props.displayName}</h2>
        <div className="button-row">
          {!props.isPrincipal ? (
            <button type="button" className="secondary" onClick={props.onSetPrincipal}>
              设为主要出镜
            </button>
          ) : (
            <span className="badge success">主要出镜</span>
          )}
          <button type="button" disabled={props.busy} onClick={props.onEdit}>
            编辑 / 发布新版本
          </button>
          <button
            type="button"
            className="danger"
            disabled={props.isPrincipal}
            title={props.isPrincipal ? '请先指定另一名主要出镜' : undefined}
            onClick={props.onDelete}
          >
            删除成员
          </button>
        </div>
      </div>

      {props.aliases.length > 0 ? (
        <div className="section-title">
          <h2>匹配名称 / 昵称</h2>
          <div className="tag-list">
            {props.aliases.map((a) => (
              <span key={a.aliasId} className="tag">
                {a.aliasText}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="section-title">
        <h2>{shown ? '当前人设内容' : '尚未发布人设'}</h2>
        {props.viewContent !== null ? (
          <div className="preview-box persona-content">
            {props.viewContent || '（空）'}
          </div>
        ) : (
          <p className="muted">
            该成员还没有已发布版本。点击「编辑 / 发布新版本」创建人设并发布。
          </p>
        )}
      </div>

      <div className="section-title">
        <h2>版本历史</h2>
        <div className="version-list">
          {props.versions.map((v) => {
            const isActive = props.activeVersion?.personaVersion === v.personaVersion
            const isShown = props.viewingVersion?.personaVersion === v.personaVersion
            return (
              <button
                key={v.personaVersion}
                type="button"
                className={isShown ? 'selected' : undefined}
                onClick={() => props.onViewVersion(v)}
              >
                {formatVersion(v)}
                <small>
                  {v.personaVersion.slice(0, 8)}
                  {isActive ? ' · 当前生效' : ''}
                </small>
              </button>
            )
          })}
        </div>
        {showRollback && viewedVersion !== null ? (
          <div className="button-row section-title">
            <button
              type="button"
              className="secondary"
              disabled={props.busy}
              onClick={() => props.onRollback(viewedVersion.personaVersion)}
            >
              基于此版本创建草稿
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}

function EditForm(props: {
  displayName: string
  isPrincipal: boolean
  canEdit: boolean
  draftText: string
  aliasInput: string
  busy: boolean
  onChangeDraft: (v: string) => void
  onChangeAliases: (v: string) => void
  onSaveDraft: () => void
  onPublish: () => void
  onCancel: () => void
  onDelete: () => void
  onSetPrincipal: () => void
}) {
  return (
    <>
      <div className="page-heading">
        <h2>{props.displayName}</h2>
        <div className="button-row">
          {!props.isPrincipal ? (
            <button type="button" className="secondary" onClick={props.onSetPrincipal}>
              设为主要出镜
            </button>
          ) : (
            <span className="badge success">主要出镜</span>
          )}
          <button
            type="button"
            className="danger"
            disabled={props.isPrincipal}
            title={props.isPrincipal ? '请先指定另一名主要出镜' : undefined}
            onClick={props.onDelete}
          >
            删除成员
          </button>
        </div>
      </div>

      <label>
        匹配名称 / 昵称（用逗号或顿号分隔）
        <input type="text" value={props.aliasInput} onChange={(e) => props.onChangeAliases(e.target.value)} />
      </label>

      <label>
        人设内容（发布后生成不可变版本）
        <textarea value={props.draftText} onChange={(e) => props.onChangeDraft(e.target.value)} />
      </label>
      <div className="button-row">
        <button type="button" disabled={props.busy} onClick={props.onSaveDraft}>
          保存草稿
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.busy || props.draftText.trim() === ''}
          onClick={props.onPublish}
        >
          发布此版本
        </button>
        <button type="button" className="secondary" disabled={props.busy} onClick={props.onCancel}>
          返回查看
        </button>
      </div>
      <small>昵称随草稿/发布一并保存；发布无需先保存草稿，可直接发布当前内容。发布后将在下次启动服务时生效；已发布版本不可修改，请基于草稿编辑。</small>
    </>
  )
}
