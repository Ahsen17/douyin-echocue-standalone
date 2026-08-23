import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OverlayDisplayRequestV1, OverlayPreferenceV1 } from '@echocue/contracts'
import { overlayEchocue } from './echocue'

const DEFAULT_PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
}

function rootStyle(prefs: OverlayPreferenceV1): CSSProperties {
  const dark = prefs.theme === 'dark'
  return {
    WebkitAppRegion: 'drag',
    fontFamily: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    padding: '18px 20px',
    borderRadius: '14px',
    opacity: prefs.opacity,
    fontSize: `${prefs.fontScale * 100}%`,
    background: dark ? 'rgba(17, 24, 39, 0.96)' : 'rgba(247, 249, 253, 0.97)',
    color: dark ? '#f8fbff' : '#182337',
    border: dark ? 'none' : '1px solid #dce4ef',
  } as CSSProperties
}

function App() {
  const [req, setReq] = useState<OverlayDisplayRequestV1 | null>(null)
  const [prefs, setPrefs] = useState<OverlayPreferenceV1>(DEFAULT_PREFS)
  // Latest preference mirror for the countdown start (display arrives after
  // applyPreferences pushed the prefs, but React state updates lag the IPC).
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  // Remaining display seconds for the top hint (UI §5 展示中倒计时).
  const [remainingSec, setRemainingSec] = useState<number | null>(null)

  useEffect(() => {
    const echocue = overlayEchocue()
    const offDisplay = echocue.overlay.onDisplay((next) => {
      setReq(next)
      const totalSec = Math.max(1, Math.round(prefsRef.current.durationMs / 1000))
      setRemainingSec(totalSec)
      // Ack only once the frame is actually painted (UI §5 first-frame ack).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void echocue.overlay.ack(next.requestId)
        }),
      )
    })
    const offHide = echocue.overlay.onHide(() => {
      setReq(null)
      setRemainingSec(null)
    })
    const offPreference = echocue.overlay.onPreference((p) => setPrefs(p))
    return () => {
      offDisplay()
      offHide()
      offPreference()
    }
  }, [])

  // Tick the countdown once per second for the lifetime of the display window.
  useEffect(() => {
    if (req === null) return
    const id = setInterval(() => {
      setRemainingSec((prev) => (prev === null || prev <= 1 ? prev : prev - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [req])

  if (req === null) return <div style={rootStyle(prefs)} />

  const { comment, suggestion } = req.payload
  const dark = prefs.theme === 'dark'
  const replyBackground = dark ? '#27334a' : '#e8eef7'
  const authorColor = dark ? '#77a7ff' : '#215cbf'
  return (
    <div style={rootStyle(prefs)}>
      <small style={{ display: 'block', opacity: 0.72 }}>
        Echocue 提示　展示中 · {remainingSec ?? 0} 秒
      </small>
      {comment.nickname ? (
        <p style={{ margin: '8px 0 0', color: authorColor, fontWeight: 700 }}>
          @{comment.nickname}
          {comment.sentAt ? (
            <span style={{ marginLeft: 8, fontSize: '0.8em', fontWeight: 400, opacity: 0.72 }}>
              {comment.sentAt}
            </span>
          ) : null}
        </p>
      ) : null}
      <p style={{ margin: '6px 0 0' }}>“{comment.text}”</p>
      <div style={{ margin: '14px 0 0', padding: '12px 14px', borderRadius: '10px', background: replyBackground }}>
        <small>可以这样说</small>
        <b style={{ display: 'block', marginTop: 6 }}>{suggestion.quickReply}</b>
      </div>
      <p style={{ margin: '10px 0 0' }}>
        <small>提词：{suggestion.cues.join(' · ')}</small>
      </p>
    </div>
  )
}

export default App
