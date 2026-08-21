import { useState } from 'react';
import { runFixtures, type RunFixture } from '../mock-data';

export function RunPage() {
  const [fixture, setFixture] = useState<RunFixture>('LISTENING');
  const state = runFixtures[fixture];

  const act = () => {
    if (fixture === 'STOPPED' || fixture === 'ROOM_OFFLINE') setFixture('GATE_CONNECTING');
    else if (fixture === 'GATE_CONNECTING') setFixture('STOPPED');
    else if (fixture !== 'AUDIT_UNAVAILABLE') setFixture('STOPPED');
  };

  return <>
    <div className="page-heading"><div><h1>运行</h1><p>手动启动；未开播、下播或断连后不会自动恢复。</p></div><label className="fixture">审查状态<select value={fixture} onChange={event => setFixture(event.target.value as RunFixture)}>{Object.keys(runFixtures).map(key => <option key={key}>{key}</option>)}</select></label></div>
    <section className={`card status ${state.tone}`}>
      <button className={fixture === 'STOPPED' || fixture === 'ROOM_OFFLINE' ? '' : 'danger'} disabled={fixture === 'AUDIT_UNAVAILABLE'} onClick={act}>{state.action}</button>
      <b>● {state.label}</b>
      <p>{state.detail}</p>
      <p>当前直播间：516466932480　团队：Echocue 试播团队　主要出镜：小A</p>
    </section>
    <section className="card"><h2>最近活动</h2><div className="metrics compact"><div><small>最近收到</small><strong>刚刚</strong></div><div><small>最近处理</small><strong>{fixture === 'DISPLAYING' ? '建议展示中' : '已展示后隐藏'}</strong></div><div><small>端到端</small><strong>1.8 秒</strong></div><div><small>当前活动</small><strong>{fixture}</strong></div></div><small>展示期内不生成下一条建议，也不排队。</small></section>
  </>;
}
