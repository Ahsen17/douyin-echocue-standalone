import { useState, useEffect, type KeyboardEvent, type ComponentType } from 'react'
import { NAV_ITEMS, type PageName, type PageProps } from './nav'
import RunPage from './pages/RunPage'
import RoomAiPage from './pages/RoomAiPage'
import PersonaPage from './pages/PersonaPage'
import SafetyPage from './pages/SafetyPage'
import PreferencesPage from './pages/PreferencesPage'
import DiagnosticsPage from './pages/DiagnosticsPage'
import AuditPage from './pages/AuditPage'

const pages: Record<PageName, ComponentType<PageProps>> = {
  运行: RunPage,
  直播间: RoomAiPage,
  团队与人设: PersonaPage,
  安全与禁忌: SafetyPage,
  浮窗偏好: PreferencesPage,
  诊断: DiagnosticsPage,
  审计追溯: AuditPage,
}

function App() {
  const [page, setPage] = useState<PageName>('运行')
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.echocue.window.onMaximizeChange(setIsMaximized)
  }, [])

  function handleKeyActivate(fn: () => void) {
    return (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fn()
      }
    }
  }

  const CurrentPage = pages[page]

  return (
    <div className="app">
      <header className="titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div
          className="window-controls"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="window-dot close"
            aria-label="关闭并隐藏到托盘"
            title="关闭并隐藏到托盘"
            onClick={() => window.echocue.window.close()}
            onKeyDown={handleKeyActivate(() => window.echocue.window.close())}
          />
          <button
            className="window-dot minimize"
            aria-label="最小化"
            title="最小化"
            onClick={() => window.echocue.window.minimize()}
            onKeyDown={handleKeyActivate(() => window.echocue.window.minimize())}
          />
          <button
            className="window-dot maximize"
            aria-label={isMaximized ? '还原' : '最大化'}
            title={isMaximized ? '还原' : '最大化'}
            onClick={() => window.echocue.window.maximize()}
            onKeyDown={handleKeyActivate(() => window.echocue.window.maximize())}
          />
        </div>
        <strong className="titlebar-title">Echocue</strong>
      </header>
      <aside role="navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === page ? 'active' : undefined}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => setPage(item)}
            onKeyDown={handleKeyActivate(() => setPage(item))}
          >
            {item}
          </button>
        ))}
      </aside>
      <article>
        <CurrentPage onNavigate={setPage} />
      </article>
    </div>
  )
}

export default App
