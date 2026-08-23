// TD-06 mock entry screen: the standalone main window is frameless, so the page
// carries its own window controls and drag region. No real account validation.
export default function WelcomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="welcome-page">
      <div className="welcome-drag" />
      <div className="welcome-controls">
        <div className="window-controls">
          <button
            className="window-dot close"
            aria-label="关闭并隐藏到托盘"
            title="关闭并隐藏到托盘"
            onClick={() => window.echocue.window.close()}
          />
          <button
            className="window-dot minimize"
            aria-label="最小化"
            title="最小化"
            onClick={() => window.echocue.window.minimize()}
          />
          <button
            className="window-dot maximize"
            aria-label="最大化"
            title="最大化"
            onClick={() => window.echocue.window.maximize()}
          />
        </div>
      </div>

      <section className="welcome-copy">
        <div className="brand-lockup">
          <span className="brand-mark">EC</span>
          <span className="brand-name">Echocue</span>
        </div>
        <p className="eyebrow">实时口播辅助</p>
        <h1>
          让每一次直播互动
          <br />
          都<em>有备而来</em>
        </h1>
        <p className="welcome-description">
          接收直播间弹幕，应用安全过滤与人设路由，检索相似案例并由 LLM
          生成简洁、自然、可直接口播的回复，实时呈现在置顶浮窗中。
        </p>
        <div className="welcome-meta">
          <span className="badge">本机运行 · 数据本地加密</span>
          <span className="badge warning">Standalone 演示环境</span>
        </div>
      </section>

      <section className="signin-panel" aria-labelledby="signin-title">
        <p className="panel-kicker">准备开始</p>
        <h2 id="signin-title">进入工作台</h2>
        <p>使用预置主播账号查看运行流程；当前版本不接入账户校验。</p>
        <button type="button" className="button-wide" onClick={onEnter}>
          进入主播工作台
        </button>
        <div className="signin-note">
          <span className="note-icon">i</span>
          <span>演示环境：界面与状态切换已就绪，真实登录将在后续版本接入。</span>
        </div>
      </section>
    </main>
  )
}
