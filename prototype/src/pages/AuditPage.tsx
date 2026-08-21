import { useMemo, useState } from 'react';
import { auditRows, type AuditRecord } from '../mock-data';

type AuditFixture = 'READY' | 'EMPTY' | 'LOADING' | 'READ_ERROR';

export function AuditPage() {
  const [authorized, setAuthorized] = useState(false);
  const [fixture, setFixture] = useState<AuditFixture>('READY');
  const [selectedId, setSelectedId] = useState(auditRows[0].id);
  const [tab, setTab] = useState<'workflow' | 'label'>('workflow');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => fixture === 'EMPTY' ? [] : auditRows.filter(row => statusFilter === '全部' || row.label === statusFilter), [fixture, statusFilter]);
  const pageRows = filtered.slice((page - 1) * 2, page * 2);
  const selected = auditRows.find(row => row.id === selectedId) ?? auditRows[0];

  if (!authorized) return <><h1>审计追溯</h1><section className="card privacy-notice"><h2>本机审计访问提示</h2><p>此处包含直播弹幕、人设快照、Provider 输入输出等原文，仅限获授权配置人员在本机查看。MVP 不提供导出或清空。</p><button onClick={() => setAuthorized(true)}>我已获授权，进入审计</button></section></>;

  return <>
    <div className="page-heading"><div><h1>审计追溯</h1><p>完整 workflow 与主观打标是同一工作区的两个入口。</p></div><div className="button-row"><span className="badge">本机加密 · 永久保存 · 不可导出</span><label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as AuditFixture)}><option>READY</option><option>EMPTY</option><option>LOADING</option><option>READ_ERROR</option></select></label></div></div>
    <section className="card filters"><label>处理结果<select><option>全部</option><option>已展示后隐藏</option><option>已过滤</option><option>展示前失效</option></select></label><label>打标状态<select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}><option>全部</option><option>未打标</option><option>已认可</option><option>已拒绝</option><option>已修正</option><option>无需打标</option></select></label><button disabled={fixture === 'LOADING'}>查询</button></section>
    {fixture === 'LOADING' && <section className="card" role="status"><b>正在查询并按需解密详情…</b></section>}
    {fixture === 'READ_ERROR' && <section className="card warning" role="alert"><b>未能读取或解密审计记录</b><p>原文不会部分展示；请检查本机存储后重试。</p><button onClick={() => setFixture('READY')}>重试</button></section>}
    {pageRows.length === 0 ? <section className="card empty-state"><b>没有匹配记录</b><p>调整筛选条件后重试；不会自动清除历史审计。</p></section> :
      <div className="split audit-layout"><section className="card audit-list"><h2>审计记录</h2>{pageRows.map(row => <button className={row.id === selected.id ? 'selected' : ''} key={row.id} onClick={() => { setSelectedId(row.id); setTab('workflow'); }}><small>{row.time} · {row.result}</small><strong>{row.comment}</strong><span>{row.label}</span></button>)}<div className="pager"><button className="secondary" disabled={page === 1} onClick={() => setPage(Math.max(1, page - 1))}>上一页</button><span>{page} / {Math.max(1, Math.ceil(filtered.length / 2))}</span><button className="secondary" disabled={page * 2 >= filtered.length} onClick={() => setPage(page + 1)}>下一页</button></div></section><section className="card grow"><h2>记录详情 · {selected.time}</h2><div className="tabs"><button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>工作流上下文</button><button className={tab === 'label' ? 'active' : ''} onClick={() => setTab('label')}>{selected.label === '未打标' ? '进入打标' : '查看 / 编辑打标'}</button></div>{tab === 'workflow' ? <Workflow record={selected} /> : <LabelForm record={selected} />}</section></div>}
  </>;
}

function Workflow({ record }: { record: AuditRecord }) {
  return <div className="workflow"><section><small>20:10:01.120 · RECEIVED</small><b>原始弹幕</b><p>{record.comment}</p></section><section><small>20:10:01.126 · NORMALIZED</small><b>输入安全规则 v4</b><p>{record.result === '已过滤' ? 'FILTERED · TEAM_FORBIDDEN' : '通过 · 无风险命中'}</p></section>{record.hasSuggestion && <><section><small>20:10:01.148 · ROUTED</small><b>成员路由</b><p>唯一昵称命中小A · persona v3 · 人设快照可展开查看</p></section><section><small>20:10:01.226 · RETRIEVING</small><b>双路 TopK 与语义初筛</b><table><tbody><tr><td>golden_set</td><td>golden-21</td><td>0.82</td><td>positive_praise</td></tr><tr><td>pre_set</td><td>pre-000001</td><td>0.78</td><td>positive_praise</td></tr></tbody></table></section><section><small>20:10:01.244 · PROMPT_RENDERED → LLM_PENDING</small><b>最终 Prompt 与 Provider 请求</b><p>按本条绑定的人设、安全版本和 TopK 渲染；原始响应按需展开。</p></section><section><small>20:10:02.744 · GENERATED</small><b>Provider 输出</b><p>短回复：今天状态是被你们夸出来的，继续陪我热闹一下！</p><p>提词：接住夸奖 · 邀请互动 · 延展话题</p></section><section><small>20:10:02.920 · DISPLAYED → HIDDEN</small><b>浮窗结果</b><p>首帧 1.8 秒；展示 10 秒后自然隐藏。</p></section></>}</div>;
}

function LabelForm({ record }: { record: AuditRecord }) {
  const [approved, setApproved] = useState(true);
  const [corrected, setCorrected] = useState(false);
  const [saved, setSaved] = useState(record.label !== '未打标');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  if (!record.hasSuggestion) return <div className="empty-state"><b>无需打标</b><p>本条没有最终建议，仅可查看 workflow 上下文。</p></div>;
  if (saved && !editing) return <div className="label-summary"><b>{record.label === '未打标' ? (approved ? '已认可' : '已拒绝') : record.label}</b><p>主观质量分：{approved ? '85' : '0'} / 100</p><p>已保存为当前有效打标；再次编辑会产生新修订，不覆盖历史。</p><button onClick={() => setEditing(true)}>编辑本次打标</button></div>;
  return <div className="label-form"><p><b>为本条最终建议打标</b></p><label className="choice"><input type="radio" checked={approved} onChange={() => setApproved(true)} /> 认可建议</label><label className="choice"><input type="radio" checked={!approved} onChange={() => setApproved(false)} /> 不认可建议</label>{approved ? <label>主观质量分（0–100）<input type="number" min="0" max="100" defaultValue="85" /></label> : <><p>原建议将记为 0 分。</p><label className="checkbox"><input type="checkbox" checked={corrected} onChange={e => setCorrected(e.target.checked)} /> 填写主播认为更好的答案</label>{corrected && <><label>更优短回复<textarea defaultValue="谢谢你们把今天的状态拉满了，接着聊！" /></label><label>提词（2–3 条）<input defaultValue="接住夸奖 · 回到当前话题" /></label><label>修正答案质量分<input type="number" min="0" max="100" defaultValue="85" /></label></>}</>} {saving && <p className="inline-message" role="status">正在保存打标…</p>}{saveError && <p className="inline-message danger-text" role="alert">未能保存打标；输入仍保留，请重试。</p>}<div className="button-row"><button disabled={saving} onClick={() => { setSaving(true); setSaveError(false); window.setTimeout(() => { setSaving(false); setSaved(true); setEditing(false); }, 500); }}>保存打标</button><button className="secondary" onClick={() => setSaveError(true)}>模拟保存失败</button>{editing && <button className="secondary" onClick={() => setEditing(false)}>取消</button>}</div><small>这里只显示用户可理解的打标状态，不显示案例库、阈值或同步机制。</small></div>;
}
