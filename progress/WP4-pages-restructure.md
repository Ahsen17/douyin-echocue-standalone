# WP-4：运行页阈值配置 + 五页重构 + 导航图标 + 补充七/八

> 综合实施计划第五个工作包：导航收敛为 5 个一级页面；运行页暴露双检索阈值；新增系统设置「运行机制」区块（承载 WP-2 排队与 WP-3 保留期 UI）；左侧导航图标；直播间标识 placeholder 更新；审计页去除前置授权门禁。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 综合计划 WP-4（含补充六/七/八） |
| 分支 | feat/pages-restructure |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |
| 关联 | WP-0（阈值/queueing/audit/metrics 契约）、WP-1（监控诊断页）、WP-2（排队）、WP-3（保留期） |

## 改动

### 页面重构（8 页 → 5 页）

| 文件 | 改动 |
|------|------|
| `src/renderer/main/nav.ts` | NAV_ITEMS 收敛为 `服务运行/直播设置/系统设置/监控诊断/审计追溯` |
| `src/renderer/main/App.tsx` | 页面映射更新；侧栏按钮渲染 `<NavIcon>`；`审计追溯` 保持 `page-fluid` |
| `src/renderer/main/components/NavIcon.tsx`（新） | 每页一个内联 SVG 图标（Lucide 24×24 stroke 路径，currentColor，无新依赖）；导出 `NAV_ICONS` 供测试 |
| `src/renderer/main/pages/LiveSettingsPage.tsx`（新） | 直播设置聚合页：tab = 直播间（RoomSection）/ 团队与人设（PersonaPage）/ 安全与禁忌（SafetyPage） |
| `src/renderer/main/pages/SystemSettingsPage.tsx`（新） | 系统设置聚合页：tab = AI 服务（ProviderSection）/ 提示词（PromptSection）/ 浮窗偏好（OverlaySection）/ 运行机制（RuntimeSection） |
| `src/renderer/main/pages/settings-tabs.ts`（新） | tab 定义纯模块（供单测断言，不拉起 React） |
| `src/renderer/main/components/RoomSection.tsx`（新） | 直播间标识卡片（自 RoomAiPage 拆出，独立保存）；placeholder 改为「输入抖音直播间ID，可通过网页版抖音查看获取。」（补充七） |
| `src/renderer/main/components/ProviderSection.tsx`（新） | AI 服务表单卡片（自 RoomAiPage 拆出，不再捆绑 roomReference 保存） |
| `src/renderer/main/components/PromptSection.tsx`（新） | 提示词面板（原 PromptPage 去页面头） |
| `src/renderer/main/components/OverlaySection.tsx`（新） | 浮窗偏好面板（原 PreferencesPage 去页面头，保留实时预览） |
| 删除 | `pages/RoomAiPage.tsx`、`pages/PromptPage.tsx`、`pages/PreferencesPage.tsx` |
| `src/renderer/main/pages/RunPage.tsx` | 标题改「服务运行」；新增检索置信度阈值卡片；MISSING_CONFIG 导航目标更新（直播间/人设→直播设置，AI→系统设置）；浮窗偏好链接→系统设置 |
| `src/renderer/main/components/RetrievalCard.tsx` | 「查看诊断」导航→监控诊断 |
| `src/renderer/main/pages/DiagnosticsPage.tsx` | 标题改「监控诊断」 |
| `src/renderer/main/pages/AuditPage.tsx` | 删除 authorized 门禁分支，挂载即查询（补充八）；保留头部信息性 badge |
| `src/renderer/main/styles.css` | 新增 `.nav-icon`；删除 `.privacy-notice` |
| `prototype/src/pages/ConfigPages.tsx` | placeholder 同步（补充七） |

### 运行页阈值配置 + 运行时接线

| 文件 | 改动 |
|------|------|
| `src/renderer/main/run/thresholds.ts`（新） | 表单种子/校验（0–1，空串→NaN 拒绝）/构建 update 的纯逻辑 |
| `src/main/suggestion/types.ts` | deps 新增 `getDirectPushThreshold?` / `getSemanticDiscardConfidence?` |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | startSession 冻结两个阈值（与 safety/prompt/queueing 同模式）；`effectiveCalibrationArtifact()` 用冻结丢弃阈值覆盖默认 artifact 的 confidence 字段；direct push 用冻结阈值 |
| `src/main/service/create-controller.ts` | 从 `settings.internalRetrieval` 接线两个 getter（缺省 0.85/0.9） |

### 系统设置「运行机制」（WP-2.3 + WP-3.3 UI）

| 文件 | 改动 |
|------|------|
| `src/renderer/main/system/runtime-settings.ts`（新） | 表单种子（ms→秒）/校验（排队超时 1–120s、保留 7–180 天、端口 1024–65535）/构建 update |
| `src/renderer/main/components/RuntimeSection.tsx`（新） | 弹幕排队（开关+超时）、数据与保留（保留天数）、监控端点（/metrics 端口）三卡片整卡保存 |

### 测试

| 文件 | 改动 |
|------|------|
| `tests/unit/renderer/nav.test.ts` | 5 项导航 + 每页有图标 + tab 布局断言 |
| `tests/unit/renderer/thresholds.test.ts`（新） | 种子/合法区间/非法与空串拒绝/默认值对齐（+4） |
| `tests/unit/renderer/runtime-settings.test.ts`（新） | 种子/组合 update/越界与非整数拒绝/默认值对齐（+5） |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | +2：冻结 directPush 阈值改变直出判定（走 LLM）；冻结语义丢弃阈值触发 LOW_VALUE 丢弃（0 provider 调用） |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 182 passed / 0 failed
- `npm run test` ✅ 1125 passed / 5 skipped（既有 skip）
- `npm run build` ✅

## 说明

- **provider-form/provider-save**：`roomReference` 入参改为可选（AI 服务保存不再捆绑直播间），既有调用与测试不受影响。
- **阈值生效时机**：与安全/提示词一致，startSession 冻结、会话内不热切换；UI 提示「下次启动服务时生效」。
- **图标**：内联 SVG（Lucide ISC 路径数据），stroke/currentColor 跟随现有 nav 配色，无新增依赖。
- **文档同步**（UI §2 五页、诊断页命名、审计门禁删除）随 WP-7 文档批次处理。
