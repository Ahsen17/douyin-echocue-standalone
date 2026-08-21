import { useState, type ComponentType } from 'react';
import { nav, type PageName } from './mock-data';
import { RunPage } from './pages/RunPage';
import { PersonaPage } from './pages/PersonaPage';
import { AuditPage } from './pages/AuditPage';
import { RoomAi, Safety, Preferences, Diagnostics } from './pages/ConfigPages';
import { OverlayPage } from './pages/OverlayPage';

const pages: Record<PageName, ComponentType> = {
  运行: RunPage,
  '直播间与 AI': RoomAi,
  团队与人设: PersonaPage,
  安全与禁忌: Safety,
  浮窗偏好: Preferences,
  诊断: Diagnostics,
  审计追溯: AuditPage,
  '直播浮窗（原型）': OverlayPage,
};

export default function App() {
  const [page, setPage] = useState<PageName>('运行');
  const [windowMessage, setWindowMessage] = useState('');
  const [maximized, setMaximized] = useState(false);
  const Page = pages[page];

  const windowAction = (message: string) => {
    setWindowMessage(message);
    window.setTimeout(() => setWindowMessage(''), 2200);
  };

  return <main className={`app ${maximized ? 'maximized' : ''}`}>
    <header className="titlebar">
      <div className="window-controls" aria-label="窗口控制（静态原型）">
        <button className="window-dot close" aria-label="关闭并隐藏到托盘" title="关闭并隐藏到托盘" onClick={() => windowAction('原型：主窗口已隐藏到托盘；服务保持运行')} />
        <button className="window-dot minimize" aria-label="最小化" title="最小化" onClick={() => windowAction('原型：窗口已最小化')} />
        <button className="window-dot maximize" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} onClick={() => setMaximized(value => !value)} />
      </div>
      <strong>Echocue</strong>
      {windowMessage && <span className="toast" role="status">{windowMessage}</span>}
    </header>
    <aside>
      {nav.slice(0, 7).map(item => <button className={item === page ? 'active' : ''} onClick={() => setPage(item)} key={item}>{item}</button>)}
      <small className="dev-label">原型辅助</small>
      <button className={page === '直播浮窗（原型）' ? 'active' : ''} onClick={() => setPage('直播浮窗（原型）')}>直播浮窗（独立窗口）</button>
    </aside>
    <article><Page /></article>
  </main>;
}
