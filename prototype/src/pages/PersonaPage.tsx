import { useState } from 'react';

interface Member { id: number; name: string; principal: boolean; version: number }
type PersonaFixture = 'READY' | 'EMPTY' | 'LOADING' | 'SAVE_ERROR';

const initialMembers: Member[] = [
  { id: 1, name: '小A', principal: true, version: 3 },
  { id: 2, name: '阿哲', principal: false, version: 2 },
  { id: 3, name: '运营小林', principal: false, version: 1 },
];

export function PersonaPage() {
  const [fixture, setFixture] = useState<PersonaFixture>('READY');
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [selected, setSelected] = useState(1);
  const [preview, setPreview] = useState(false);
  const [compare, setCompare] = useState(false);
  const [message, setMessage] = useState('');
  const visibleMembers = fixture === 'EMPTY' ? [] : members;
  const member = members.find(item => item.id === selected) ?? members[0];
  const add = () => { const id = Math.max(0, ...members.map(item => item.id)) + 1; setMembers([...members, { id, name: `新成员${id}`, principal: members.length === 0, version: 0 }]); setSelected(id); setFixture('READY'); };
  const setPrincipal = () => setMembers(members.map(item => ({ ...item, principal: item.id === member.id })));
  const remove = () => { if (member.principal) { setMessage('请先指定另一名主要出镜人员'); return; } const next = members.filter(item => item.id !== member.id); setMembers(next); setSelected(next[0]?.id ?? 0); if (!next.length) setFixture('EMPTY'); };

  return <>
    <div className="page-heading"><div><h1>团队与人设</h1><p>历史版本只读；回滚会创建新的草稿与版本。</p></div><div className="button-row"><label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as PersonaFixture)}><option>READY</option><option>EMPTY</option><option>LOADING</option><option>SAVE_ERROR</option></select></label><button onClick={add}>新增成员</button></div></div>
    {fixture === 'LOADING' && <section className="card"><b>正在读取版本历史…</b></section>}
    {fixture === 'SAVE_ERROR' && <p className="inline-message danger-text" role="alert">保存或发布失败；当前草稿仍保留在编辑器中，请重试。</p>}
    {visibleMembers.length === 0 ? <section className="card empty-state"><b>尚未添加成员</b><p>先新增主要出镜人员，再配置昵称和自然语言人设。</p><button onClick={add}>新增第一位成员</button></section> :
      <div className="split"><section className="card member-list"><h2>成员</h2>{visibleMembers.map(item => <button className={item.id === selected ? 'selected' : ''} onClick={() => setSelected(item.id)} key={item.id}>{item.principal ? '● ' : ''}{item.name}<small>{item.principal ? '主要出镜' : `已发布 v${item.version}`}</small></button>)}</section><section className="card grow"><div className="page-heading"><h2>{member.name} · {member.version ? `当前已发布 v${member.version}` : '尚未发布'}</h2><div className="button-row"><button className="secondary" onClick={setPrincipal}>设为主要出镜</button><button className="danger" onClick={remove}>删除</button></div></div>{message && <p className="inline-message danger-text">{message}</p>}<label>匹配名称 / 昵称<input defaultValue={`${member.name}、常见别称、同音变体`} key={`${member.id}-alias`} /></label><label>人设内容<textarea defaultValue="直播风格轻松、有回应感；优先接住观众正向互动，避免讨论私密信息与攻击性话题……" key={`${member.id}-content`} /></label>{preview && <div className="preview-box"><b>只读预览</b><p>直播风格轻松、有回应感；优先接住正向互动……</p></div>}{compare && <div className="preview-box"><b>v3 与 v2 对比</b><p>v3：增加“先接住夸奖再延展话题”；v2：仅定义轻松风格。</p></div>}<div className="button-row"><button className="secondary" onClick={() => setPreview(!preview)}>{preview ? '关闭预览' : '预览'}</button><button onClick={() => setMessage('草稿已保存')}>保存草稿</button><button onClick={() => setMessage(`已发布为 v${member.version + 1}；下次启动生效`)}>发布此版本</button></div><h2 className="section-title">版本历史</h2><div className="version-list"><button onClick={() => setCompare(!compare)}>v{member.version} 当前已发布 · 查看/比较</button><button onClick={() => setMessage('已基于历史 v2 创建新草稿；发布后生成新版本')}>v2 已替代 · 基于此版本创建草稿</button><button onClick={() => setCompare(true)}>v1 已替代 · 查看/比较</button></div></section></div>}
  </>;
}
