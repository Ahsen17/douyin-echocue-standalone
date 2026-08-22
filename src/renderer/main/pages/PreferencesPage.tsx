import { useEffect, useState } from 'react'
import type { OverlayPreferenceV1 } from '@echocue/contracts'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { EmptyState, LoadingState } from '../components/StateViews'
import {
  DEFAULT_OVERLAY_PREFS,
  formToPref,
  prefToForm,
  validateDurationSec,
  type OverlayPrefForm,
} from '../overlay/overlay-prefs'

function OverlayPreview({ prefs }: { prefs: OverlayPreferenceV1 }) {
  const durationSec = Math.round(prefs.durationMs / 1000)
  return (
    <section
      className={`overlay ${prefs.theme}`}
      style={{
        width: `min(${prefs.width}px, 100%)`,
        opacity: prefs.opacity,
        fontSize: `${prefs.fontScale * 100}%`,
      }}
    >
      <small>Echocue 提示　展示中 · {durationSec} 秒</small>
      <p className="comment-author">@观众A</p>
      <p>“主播晚上好，今天状态真好！”</p>
      <div>
        <small>可以这样说</small>
        <b>今天状态是被你们夸出来的，继续陪我热闹一下！</b>
      </div>
      <p>
        <small>提词：接住夸奖 · 邀请互动 · 延展当前话题</small>
      </p>
    </section>
  )
}

export default function PreferencesPage() {
  const [form, setForm] = useState<OverlayPrefForm>(prefToForm(DEFAULT_OVERLAY_PREFS))
  const [loaded, setLoaded] = useState(false)
  const [durationError, setDurationError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useAsyncAction(async () => {
    const config = await window.echocue.config.get()
    setForm(prefToForm(config.overlay))
    setLoaded(true)
    setDurationError(null)
    setMessage(null)
    return true
  })

  useEffect(() => {
    void load.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useAsyncAction(async () => {
    const invalid = validateDurationSec(form.durationSec)
    if (invalid !== null) {
      setDurationError(invalid)
      setMessage(null)
      return true
    }
    const saved = await window.echocue.overlay.updatePreferences(formToPref(form))
    setForm(prefToForm(saved))
    setDurationError(null)
    setMessage('偏好已保存；应用于下一次展示')
    return true
  })

  const restoreDefaults = useAsyncAction(async () => {
    const saved = await window.echocue.overlay.updatePreferences(DEFAULT_OVERLAY_PREFS)
    setForm(prefToForm(saved))
    setDurationError(null)
    setMessage('已恢复默认偏好')
    return true
  })

  if (!loaded) {
    return load.error ? (
      <EmptyState
        title="浮窗偏好"
        description={load.error}
        action={
          <button type="button" onClick={() => void load.run()}>
            重试
          </button>
        }
      />
    ) : (
      <LoadingState label="正在读取浮窗偏好…" />
    )
  }

  const error = load.error ?? save.error ?? restoreDefaults.error
  const busy = load.running || save.running || restoreDefaults.running

  const setField = <K extends keyof OverlayPrefForm>(key: K, value: OverlayPrefForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (key === 'durationSec') setDurationError(null)
  }

  return (
    <section>
      <div className="page-heading">
        <h2>浮窗偏好</h2>
        <p>展示时长、尺寸、透明度、字号与主题持久化；保存后应用于下一次展示。</p>
      </div>

      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="inline-message">{message}</p> : null}

      <div className="split">
        <section className="card preference-form">
          <label>
            展示时长（秒）
            <input
              type="number"
              min="1"
              max="60"
              value={form.durationSec}
              onChange={(e) => setField('durationSec', Number(e.target.value))}
            />
          </label>
          {durationError ? (
            <p className="inline-message danger-text" role="alert">
              {durationError}
            </p>
          ) : null}

          <div className="form-grid">
            <label>
              宽度
              <input
                type="number"
                min="320"
                max="1920"
                value={form.width}
                onChange={(e) => setField('width', Number(e.target.value))}
              />
            </label>
            <label>
              高度
              <input
                type="number"
                min="120"
                max="1080"
                value={form.height}
                onChange={(e) => setField('height', Number(e.target.value))}
              />
            </label>
          </div>

          <label>
            透明度：{form.opacityPct}%
            <input
              type="range"
              min="20"
              max="100"
              value={form.opacityPct}
              onChange={(e) => setField('opacityPct', Number(e.target.value))}
            />
          </label>

          <label>
            字号：{form.fontScalePct}%
            <input
              type="range"
              min="75"
              max="200"
              value={form.fontScalePct}
              onChange={(e) => setField('fontScalePct', Number(e.target.value))}
            />
          </label>

          <label>
            主题
            <select
              value={form.theme}
              onChange={(e) => setField('theme', e.target.value as OverlayPreferenceV1['theme'])}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.clickThrough}
              onChange={(e) => setField('clickThrough', e.target.checked)}
            />
            点击穿透（可从托盘恢复操作）
          </label>
          {form.clickThrough ? (
            <p className="inline-message">开启后将无法直接拖动，请在偏好页关闭后调整</p>
          ) : null}

          <div className="button-row">
            <button type="button" disabled={busy} onClick={() => void save.run()}>
              保存偏好
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void restoreDefaults.run()}
            >
              恢复默认
            </button>
            <span className="badge">应用于下一次展示</span>
          </div>
          <small>保存失败不覆盖当前可用设置。</small>
        </section>

        <OverlayPreview prefs={formToPref(form)} />
      </div>
    </section>
  )
}
