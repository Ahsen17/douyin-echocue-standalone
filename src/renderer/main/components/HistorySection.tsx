import { useEffect, useState } from 'react'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { EmptyState } from './StateViews'
import {
  HISTORY_DEFAULT_ENTRIES,
  HISTORY_MAX_ENTRIES,
  HISTORY_MIN_ENTRIES,
  validateMaxEntries,
} from '../history/history-section-logic'

// 系统设置页「历史窗口」面板：服务运行期间浮窗旁的历史建议条数上限（1–120）。
export default function HistorySection() {
  const [maxEntries, setMaxEntries] = useState<number>(HISTORY_DEFAULT_ENTRIES)
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const config = await window.echocue.config.get()
    setMaxEntries(config.history.maxEntries)
    setLoaded(true)
    setMessage(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useAsyncAction(async () => {
    const invalid = validateMaxEntries(maxEntries)
    if (invalid !== null) {
      setError(invalid)
      setMessage(null)
      return true
    }
    await window.echocue.config.update({ historyMaxEntries: maxEntries })
    setError(null)
    setMessage('已保存；超出上限的最旧条目会被清理')
    return true
  })

  if (!loaded) {
    return load.error ? (
      <EmptyState
        title="历史窗口"
        description={load.error}
        action={
          <button type="button" onClick={() => void load.run()}>
            重试
          </button>
        }
      />
    ) : (
      <p className="muted">正在读取历史窗口设置…</p>
    )
  }

  const busy = load.running || save.running
  const displayError = load.error ?? save.error ?? error

  return (
    <section className="card preference-form">
      <p className="muted">
        历史建议窗口只在服务运行时显示，按时间顺序记录最近展示的建议（弹幕 + AI 回复 + 提词）；数据仅存内存，停止服务或退出程序自动清空。
      </p>
      {displayError ? <p className="danger-text">{displayError}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}
      <label>
        保留条数上限
        <input
          type="number"
          min={HISTORY_MIN_ENTRIES}
          max={HISTORY_MAX_ENTRIES}
          value={maxEntries}
          onChange={(e) => {
            setMaxEntries(Number(e.target.value))
            setError(null)
          }}
        />
      </label>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void save.run()}>
          保存
        </button>
        <span className="badge">最多 {HISTORY_MAX_ENTRIES} 条</span>
      </div>
    </section>
  )
}
