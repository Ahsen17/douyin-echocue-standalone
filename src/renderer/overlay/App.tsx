import { useEffect, useState, type CSSProperties } from 'react'
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

  useEffect(() => {
    const echocue = overlayEchocue()
    const offDisplay = echocue.overlay.onDisplay((next) => {
      setReq(next)
      // Ack only once the frame is actually painted (UI §5 first-frame ack).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void echocue.overlay.ack(next.requestId)
        }),
      )
    })
    const offHide = echocue.overlay.onHide(() => setReq(null))
    const offPreference = echocue.overlay.onPreference((p) => setPrefs(p))
    return () => {
      offDisplay()
      offHide()
      offPreference()
    }
  }, [])

  if (req === null) return <div style={rootStyle(prefs)} />

  const { comment, suggestion } = req.payload
  const dark = prefs.theme === 'dark'
  const replyBackground = dark ? '#27334a' : '#e8eef7'
  const authorColor = dark ? '#77a7ff' : '#215cbf'
  return (
    <div style={rootStyle(prefs)}>
      {comment.nickname ? (
        <p style={{ margin: 0, color: authorColor, fontWeight: 700 }}>@{comment.nickname}</p>
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
