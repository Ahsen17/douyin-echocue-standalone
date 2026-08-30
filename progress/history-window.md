# 历史建议窗口（history-window）

> 新增独立置顶历史建议窗口：服务运行时自动显示，滚动展示最近 N 条成功展示的建议（弹幕 + AI 回复 + 提词），超出 N 自动清理最旧条目；数据仅存内存，停止服务或退出程序自动清空，不持久化。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入功能（非路图原子任务） |
| 分支 | feat/history-window |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-30 |

## 需求与决策（用户确认）

| 决策 | 结论 |
|------|------|
| 记录范围 | 仅成功展示的建议（`displaySink.show` first-frame ack 成功后记录）；被过滤/丢弃/未展示内容不进历史 |
| 窗口形态 | 置顶无边框透明浮动面板（同浮窗），可拖拽/缩放 |
| 打开方式 | 服务进入 RUNNING 自动显示；停止时窗口保留但内容清空 |
| 条数上限 N | 默认 20，可配置，上限 120（系统设置新增「历史窗口」页签） |
| 视觉 | 复用浮窗主题/字号偏好（`settings.overlay.theme/fontScale`） |

## 设计要点

- **内存环形缓冲**：`HistoryBuffer` 按时间顺序追加，超出容量修剪最旧；停止服务/退出清空，不落盘。
- **纯视图 renderer**：历史窗口 renderer 是主进程缓冲的纯视图——每次变更（追加/清空/容量调整）由主进程推送**全量** `HistorySnapshotV1`，挂载时经 `history.getSnapshot` 取快照；规避增量推送与快照请求之间的丢条/重复竞态。
- **展示链路接线**：`createHistoryAwareSink(inner, history)` 包装 display sink，仅在 `show` 成功（first-frame ack）后 `history.record(payload)`；golden 直出与 LLM 两条路径都走同一 `display()` 漏斗，无遗漏。
- **生命周期**：`stateMachine.onChanged` RUNNING 转态 `history.show()`；`cleanupOnStop` 清空缓冲；退出销毁窗口。
- **权限隔离**：`history-preload` 仅暴露只读快照/偏好事件 + `history.getSnapshot`；trusted-sender 只认历史窗口自身；`HistoryEntryV1` 无 trace 字段。

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts` | 抽取 `OverlayCommentV1Schema`；新增 `HistoryEntryV1/HistorySnapshotV1/HistoryConfigV1`；`SettingsV1.history`(可选)、`ConfigViewV1.history`、`ConfigUpdateRequestV1.historyMaxEntries` |
| `src/shared/ipc-channels.ts` | `history.getSnapshot` / `history.snapshot.changed` / `history.preference.changed` |
| `src/main/history/`（新） | `history-buffer.ts`（环形缓冲）、`history-controller.ts`（record/clear/applyCapacity/getSnapshot/applyVisualPrefs）、`history-control-ipc.ts`（guarded wire）、`index.ts`（`createHistoryAwareSink`） |
| `src/main/windows/HistoryWindow.ts`（新） | 置顶无边框浮动面板，默认 420×640、主屏右侧，最小 preload |
| `src/preload/history-preload.ts`（新） | 只读快照/偏好事件 + getSnapshot |
| `src/renderer/history/`（新） | `index.html/main.tsx/App.tsx/styles.css/echocue.ts`：滚动列表、自动滚底（仅用户已在底部时）、空态、拖拽条 |
| `vite.config.renderer.ts` / `vite.config.preload-history.ts`(新) / `package.json` | history 渲染入口 + preload 构建 |
| `src/main/config/{SettingsStore,config-control-handlers,config-control-ipc}.ts` | `history` 默认/视图/更新 + 容量与视觉 live-apply |
| `src/renderer/main/pages/{settings-tabs,SystemSettingsPage}.tsx` + `components/HistorySection.tsx`(新) + `history/history-section-logic.ts`(新) | 「历史窗口」页签与条数上限表单 |
| `src/main/index.ts` | HistoryWindow/controller 创建、sink 组合、RUNNING 显示、stop 清空、quit 销毁、wire 接线 |
| 测试 | 见「验证」 |

不改：路图、浮窗（OverlayWindow 仍单条展示）、审计/Qdrant/Provider/安全路由/Prompt、`prototype/`。

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 201 passed
- `npm run test` ✅ 1208 passed / 5 skipped（跳过项为既有 sidecar 二进制依赖与 Windows 安装类测试）
- `npm run build` ✅（history 渲染入口 + history-preload 构建通过）

新增测试：`tests/unit/history/{history-buffer,history-controller,history-aware-sink}.test.ts`、`tests/e2e/T-HST-001-history-window.test.ts`、`tests/integration/history/history-control-ipc.test.ts`、`tests/unit/renderer/history-section.test.ts`；扩展 `ipc-allowlist`、`preload-surface`、`config-handlers`、`settings-store`、`nav` 测试。

## 已知限制与后续

- 历史窗口停止服务后保留空窗口（用户已确认）；若实测发现空置顶窗干扰直播，可改为停止即隐藏（需用户确认）。
- 容量 `maxEntries` 为持久化设置（settings.json），历史**内容**不持久化。
- 未做完整 Electron 运行级 E2E（display → 历史窗口 renderer）；各接缝已单测覆盖（sink 组合 / 窗口行为 / IPC / 配置）。
