import { useEffect, useRef, useState } from 'react'
import type { HistoryEntryV1, HistorySnapshotV1, OverlayPreferenceV1 } from '@echocue/contracts'
import { historyEchocue } from './echocue'

const DEFAULT_PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
}

const EMPTY_SNAPSHOT: HistorySnapshotV1 = { entries: [], capacity: 20 }

function App() {
  const [snap, setSnap] = useState<HistorySnapshotV1>(EMPTY_SNAPSHOT)
  const [prefs, setPrefs] = useState<OverlayPreferenceV1>(DEFAULT_PREFS)
  const listRef = useRef<HTMLDivElement | null>(null)
  // Main pushes a full snapshot per mutation; the mount-time getSnapshot must not
  // overwrite a newer pushed snapshot (pushed.current guards the stale overwrite).
  const pushedRef = useRef(false)
  const [stickyBottom, setStickyBottom] = useState(true)

  useEffect(() => {
    const echocue = historyEchocue()
    const offSnapshot = echocue.history.onSnapshot((next) => {
      pushedRef.current = true
      setSnap(next)
    })
    const offPreference = echocue.history.onPreference(setPrefs)
    void echocue.history.getSnapshot().then((next) => {
      if (!pushedRef.current) setSnap(next)
    })
    return () => {
      offSnapshot()
      offPreference()
    }
  }, [])

  // Newest entries land at the bottom; only auto-scroll there while the user is
  // already near the bottom so reviewing older suggestions is not interrupted.
  useEffect(() => {
    const el = listRef.current
    if (el !== null && stickyBottom) el.scrollTop = el.scrollHeight
  }, [snap, stickyBottom])

  const onScroll = () => {
    const el = listRef.current
    if (el === null) return
    setStickyBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  const dark = prefs.theme === 'dark'

  return (
    <div className={`history ${dark ? 'dark' : 'light'}`} style={{ fontSize: `${prefs.fontScale * 100}%` }}>
      <header className="history-titlebar">
        <span>Echocue 历史建议</span>
        <small>
          {snap.entries.length}/{snap.capacity}
        </small>
      </header>
      <div className="history-list" ref={listRef} onScroll={onScroll}>
        {snap.entries.length === 0 ? (
          <p className="history-empty">暂无历史建议 · 服务运行后自动记录</p>
        ) : (
          snap.entries.map((entry, index) => <HistoryCard key={index} entry={entry} />)
        )}
      </div>
    </div>
  )
}

function HistoryCard({ entry }: { entry: HistoryEntryV1 }) {
  const { comment, suggestion, displayedAt } = entry
  return (
    <article className="history-card">
      <div className="history-card-head">
        {comment.nickname ? <span className="history-author">@{comment.nickname}</span> : <span />}
        <small className="history-displayed-at">{displayedAt}</small>
      </div>
      <p className="history-text">“{comment.text}”</p>
      <div className="history-reply">
        <small>可以这样说</small>
        <b>{suggestion.quickReply}</b>
      </div>
      <p className="history-cues">
        <small>提词：{suggestion.cues.join(' · ')}</small>
      </p>
    </article>
  )
}

export default App
