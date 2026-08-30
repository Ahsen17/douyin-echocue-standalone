import { useState, type CSSProperties } from 'react';

type RoomAiFixture = 'READY' | 'EMPTY' | 'TESTING' | 'AUTH_ERROR';

export function RoomAi() {
  const [fixture, setFixture] = useState<RoomAiFixture>('READY');
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const empty = fixture === 'EMPTY';

  return <>
    <div className="page-heading">
      <div><h1>直播间与 AI</h1><p>字段不绑定具体服务商；API Key 永不回显。</p></div>
      <label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as RoomAiFixture)}><option>READY</option><option>EMPTY</option><option>TESTING</option><option>AUTH_ERROR</option></select></label>
    </div>
    <section className="card"><h2>直播间</h2><label>直播间标识<input defaultValue={empty ? '' : '516466932480'} key={`room-${fixture}`} placeholder="输入抖音直播间ID，可通过网页版抖音查看获取。" /></label><small>服务启动时确认直播间已开播；失败后关闭连接，只能手动重试。</small></section>
    <section className="card"><h2>AI 服务</h2>
      <div className="form-grid">
        <label>服务商名称<input defaultValue={empty ? '' : '主用低延迟服务'} key={`name-${fixture}`} placeholder="例如：主用模型服务" /></label>
        <label>适配器类型<select defaultValue="OPENAI_COMPATIBLE"><option>DEEPSEEK</option><option>OPENAI_COMPATIBLE</option><option>ANTHROPIC_MESSAGES</option></select></label>
        <label>Base URL<input defaultValue={empty ? '' : 'https://api.example.com'} key={`url-${fixture}`} placeholder="https://…" /></label>
        <label>Model ID<input defaultValue={empty ? '' : 'chat-model'} key={`model-${fixture}`} placeholder="由服务商提供" /></label>
        <label>API Key<input type="password" value={key} placeholder={empty ? '请输入 API Key' : '已配置；输入新值可替换'} onChange={event => setKey(event.target.value)} /></label>
      </div>
      {fixture === 'TESTING' && <p className="inline-message" role="status">正在测试连接，请稍候…</p>}
      {fixture === 'AUTH_ERROR' && <p className="inline-message danger-text" role="alert">认证失败，请检查 API Key；已保存的密钥不会显示。</p>}
      <div className="button-row"><button onClick={() => setMessage('配置有效（mock）')} disabled={fixture === 'TESTING'}>测试连接</button><button className="secondary" onClick={() => setMessage('配置已保存；API Key 不会回显')}>保存配置</button><button className="danger" onClick={() => { setKey(''); setMessage('API Key 已清除（mock）'); }}>清除 API Key</button></div>
      {message && <p className="inline-message" role="status">{message}</p>}
    </section>
  </>;
}

export function Safety() {
  const [keywords, setKeywords] = useState(['住址', '商品名']);
  const [next, setNext] = useState('');
  const [valid, setValid] = useState(false);
  const [compileError, setCompileError] = useState(false);
  const add = () => { const value = next.trim(); if (value && !keywords.includes(value)) setKeywords([...keywords, value]); setNext(''); setValid(false); };
  return <><h1>安全与禁忌</h1><section className="card"><p>基础风险内容会在检索和 Provider 调用前忽略，不会形成回复建议。</p><label>团队边界说明<textarea defaultValue="不要讨论成员的住址、感情状态与其他私密信息；禁止接住攻击、人身侮辱或挑衅性话题。" onChange={() => { setValid(false); setCompileError(false); }} /></label><div><b>关键词 / 短语</b><div className="tag-list">{keywords.map(word => <button className="tag" title="删除" onClick={() => { setKeywords(keywords.filter(item => item !== word)); setValid(false); }} key={word}>{word} ×</button>)}</div><div className="inline-add"><input value={next} placeholder="新增关键词" onChange={event => setNext(event.target.value)} /><button onClick={add}>添加</button></div></div><div className="button-row"><button onClick={() => { setValid(true); setCompileError(false); }}>校验并发布</button><button className="secondary" onClick={() => { setValid(false); setCompileError(true); }}>模拟无法编译</button><span className={`badge ${valid ? 'success' : 'warning'}`}>{valid ? '规则可执行 · 已发布 v4' : '草稿待校验'}</span></div>{compileError && <p className="inline-message danger-text" role="alert">“不合适的话题”无法确定性解释，请改成明确话题或关键词；当前草稿未发布。</p>}<small>无法确定性解释的自然语言会逐条提示并阻止发布。</small></section></>;
}

type PreferenceFixture = 'READY' | 'APPLYING' | 'SAVE_ERROR';

export function Preferences() {
  const [fixture, setFixture] = useState<PreferenceFixture>('READY');
  const [duration, setDuration] = useState(10);
  const [width, setWidth] = useState(760);
  const [height, setHeight] = useState(420);
  const [opacity, setOpacity] = useState(92);
  const [fontScale, setFontScale] = useState(100);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [clickThrough, setClickThrough] = useState(false);
  const reset = () => { setDuration(10); setWidth(760); setHeight(420); setOpacity(92); setFontScale(100); setTheme('dark'); setClickThrough(false); setFixture('READY'); };
  return <>
    <div className="page-heading"><div><h1>浮窗偏好</h1><p>新用户使用默认值；保存失败不覆盖当前可用设置。</p></div><label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as PreferenceFixture)}><option>READY</option><option>APPLYING</option><option>SAVE_ERROR</option></select></label></div>
    {fixture === 'APPLYING' && <p className="inline-message" role="status">正在应用偏好…</p>}
    {fixture === 'SAVE_ERROR' && <p className="inline-message danger-text" role="alert">保存失败；屏幕仍使用上一次有效设置，可修改后重试。</p>}
    <div className="split"><section className="card preference-form"><label>展示时长（秒）<input type="number" min="3" max="30" value={duration} onChange={e => setDuration(Number(e.target.value))} /></label><div className="form-grid"><label>宽度<input type="number" min="420" value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>高度<input type="number" min="240" value={height} onChange={e => setHeight(Number(e.target.value))} /></label></div><label>透明度：{opacity}%<input type="range" min="60" max="100" value={opacity} style={{ '--range-pct': `${((opacity - 60) / 40) * 100}%` } as CSSProperties} onChange={e => setOpacity(Number(e.target.value))} /></label><label>字号：{fontScale}%<input type="range" min="80" max="140" value={fontScale} style={{ '--range-pct': `${((fontScale - 80) / 60) * 100}%` } as CSSProperties} onChange={e => setFontScale(Number(e.target.value))} /></label><label>主题<select value={theme} onChange={e => setTheme(e.target.value as 'dark' | 'light')}><option value="dark">深色</option><option value="light">浅色</option></select></label><label className="checkbox"><input type="checkbox" checked={clickThrough} onChange={e => setClickThrough(e.target.checked)} /> 点击穿透（可从托盘恢复操作）</label><div className="button-row"><button disabled={fixture === 'APPLYING'} onClick={() => setFixture('READY')}>保存偏好</button><button className="secondary" onClick={reset}>恢复默认</button></div></section><OverlayPreview duration={duration} width={width} height={height} opacity={opacity} fontScale={fontScale} theme={theme} /></div>
  </>;
}

type DiagnosticFixture = 'READY' | 'EMPTY' | 'LOADING' | 'ERROR' | 'LOW_STORAGE';

export function Diagnostics() {
  const [fixture, setFixture] = useState<DiagnosticFixture>('READY');
  const metrics = [['最近接收弹幕', fixture === 'EMPTY' ? '暂无' : '刚刚'], ['最近建议结果', fixture === 'EMPTY' ? '暂无' : '已展示后隐藏'], ['最近端到端耗时', fixture === 'EMPTY' ? '暂无' : '1.8 秒'], ['审计存储', fixture === 'LOW_STORAGE' ? '820 MiB · 预警' : '12.4 GiB · 可用']];
  return <><div className="page-heading"><div><h1>诊断</h1><p>只显示脱敏健康信息。</p></div><label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as DiagnosticFixture)}><option>READY</option><option>EMPTY</option><option>LOADING</option><option>ERROR</option><option>LOW_STORAGE</option></select></label></div>{fixture === 'LOADING' && <section className="card"><b>正在刷新诊断摘要…</b></section>}{fixture === 'ERROR' && <section className="card warning"><b>E_SOURCE_UNAVAILABLE</b><p>无法连接弹幕服务。连接已关闭，请检查本机 sidecar 后手动重试。</p></section>}{fixture === 'LOW_STORAGE' && <section className="card warning"><b>E_STORAGE_LOW</b><p>本机存储空间不足，可能影响后续直播。不会自动删除审计，请释放其他文件或扩容。</p></section>}<section className="card"><b>{fixture === 'EMPTY' ? '暂无运行活动' : '● 服务正在监听'}</b><p>链路摘要不展示弹幕原文、密钥或内部调用细节。</p></section><div className="metrics">{metrics.map(item => <section className="card" key={item[0]}><small>{item[0]}</small><h2>{item[1]}</h2></section>)}</div></>;
}

interface OverlayPreviewProps { duration?: number; width?: number; height?: number; opacity?: number; fontScale?: number; theme?: 'dark' | 'light' }
export function OverlayPreview({ duration = 10, width = 760, height = 420, opacity = 92, fontScale = 100, theme = 'dark' }: OverlayPreviewProps) { return <section className={`overlay ${theme}`} style={{ width: `min(${width}px, 100%)`, minHeight: Math.min(height, 420), opacity: opacity / 100, fontSize: `${fontScale}%` }}><small>Echocue 提示　展示中 · {duration} 秒</small><p className="comment-author">@观众A</p><p>“主播晚上好，今天状态真好！”</p><div><small>可以这样说</small><b>今天状态是被你们夸出来的，继续陪我热闹一下！</b></div><p><small>提词：接住夸奖 · 邀请互动 · 延展当前话题</small></p></section>; }
