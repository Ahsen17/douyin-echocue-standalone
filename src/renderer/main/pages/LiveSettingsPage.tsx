import { useState } from 'react'
import type { PageProps } from '../nav'
import RoomSection from '../components/RoomSection'
import PersonaPage from './PersonaPage'
import SafetyPage from './SafetyPage'
import { LIVE_SETTINGS_TABS, type LiveSettingsTab } from './settings-tabs'

// 直播设置：直播间标识 + 团队与人设 + 安全与禁忌（UI §2 五页重构后的聚合页）。
export default function LiveSettingsPage(_props: PageProps) {
  const [tab, setTab] = useState<LiveSettingsTab>('直播间')

  return (
    <section>
      <div className="page-heading">
        <h2>直播设置</h2>
        <p>直播间标识、团队人设与安全策略；发布/保存的配置在下次启动服务时生效。</p>
      </div>
      <div className="tabs">
        {LIVE_SETTINGS_TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === tab ? 'active' : ''}
            aria-current={item === tab ? 'true' : undefined}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === '直播间' ? <RoomSection /> : null}
      {tab === '团队与人设' ? <PersonaPage /> : null}
      {tab === '安全与禁忌' ? <SafetyPage /> : null}
    </section>
  )
}
