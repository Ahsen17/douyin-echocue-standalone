import { useEffect, useState } from 'react'
import { useServiceState } from '../hooks/useServiceState'
import { useAsyncAction } from '../hooks/useAsyncAction'

// 直播设置页「直播间」卡片：直播间标识的读取与保存（与 AI 服务表单解耦）。
export default function RoomSection() {
  const serviceState = useServiceState()
  const [loaded, setLoaded] = useState(false)
  const [roomReference, setRoomReference] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.echocue.config.get().then((view) => {
      if (cancelled) return
      setRoomReference(view.roomReference ?? '')
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useAsyncAction(async () => {
    const trimmed = roomReference.trim()
    if (trimmed === '') {
      setMessage('直播间标识不能为空')
      return false
    }
    const updated = await window.echocue.config.update({ roomReference: trimmed })
    setRoomReference(updated.roomReference ?? '')
    // When the service is not known to be STOPPED, the change applies on the
    // next service start (same rule as the provider form).
    const running = !serviceState || serviceState.lifecycle !== 'STOPPED'
    setMessage(running ? '已保存；将在下次启动服务时生效' : '已保存')
    return true
  })

  if (!loaded) return <p className="muted">正在读取直播间配置…</p>

  return (
    <div className="card">
      <h2>直播间</h2>
      <label>
        直播间标识
        <input
          type="text"
          value={roomReference}
          placeholder="输入抖音直播间ID，可通过网页版抖音查看获取。"
          onChange={(e) => setRoomReference(e.target.value)}
        />
      </label>
      <p>仅需直播间标识即可接入，无需直播管理权限。</p>
      {message ? <p className="inline-message">{message}</p> : null}
      {save.error ? <p className="danger-text">{save.error}</p> : null}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={save.running}
          onClick={() => void save.run()}
        >
          {save.running ? '正在保存…' : '保存直播间'}
        </button>
      </div>
    </div>
  )
}
