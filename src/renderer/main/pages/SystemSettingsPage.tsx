import { useState } from 'react'
import type { PageProps } from '../nav'
import ProviderSection from '../components/ProviderSection'
import RuntimeSection from '../components/RuntimeSection'
import PromptSection from '../components/PromptSection'
import OverlaySection from '../components/OverlaySection'
import HistorySection from '../components/HistorySection'
import { SYSTEM_SETTINGS_TABS, type SystemSettingsTab } from './settings-tabs'

function initialTab(hint?: string): SystemSettingsTab {
  return SYSTEM_SETTINGS_TABS.includes(hint as SystemSettingsTab)
    ? (hint as SystemSettingsTab)
    : 'AI 服务'
}

// 系统设置：AI 服务 + 提示词 + 浮窗偏好 + 运行机制（UI §2 五页重构后的聚合页）。
export default function SystemSettingsPage({ initialTab: hint }: PageProps) {
  const [tab, setTab] = useState<SystemSettingsTab>(() => initialTab(hint))

  return (
    <section>
      <div className="page-heading">
        <h2>系统设置</h2>
        <p>AI 服务、提示词、浮窗偏好与运行机制；除浮窗视觉项外均在下次启动服务/应用时生效。</p>
      </div>
      <div className="tabs">
        {SYSTEM_SETTINGS_TABS.map((item) => (
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
      {tab === 'AI 服务' ? <ProviderSection /> : null}
      {tab === '提示词' ? <PromptSection /> : null}
      {tab === '浮窗偏好' ? <OverlaySection /> : null}
      {tab === '历史窗口' ? <HistorySection /> : null}
      {tab === '运行机制' ? <RuntimeSection /> : null}
    </section>
  )
}
