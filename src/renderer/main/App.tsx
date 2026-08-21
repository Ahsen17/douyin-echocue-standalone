import { useState, useEffect, type KeyboardEvent } from 'react'

declare global {
  interface Window {
    echocue: {
      window: {
        close: () => void
        minimize: () => void
        maximize: () => void
        onMaximizeChange: (cb: (isMax: boolean) => void) => void
      }
    }
  }
}

function App() {
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
      <div className="content" style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <h1>Echocue Main Window</h1>
        <p>Electron + Vite + React + TypeScript 工程基线已建立</p>
        <p>Context isolation: enabled ✓</p>
        <p>Node integration: disabled ✓</p>
      </div>
    </div>
  )
}

export default App
