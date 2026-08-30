# TD-06：UI 界面优化（固定布局 + 登录入口 + 审计双栏 + 浮窗置顶）

> 技术债务批次 `feat/TD-06-07-08` 第三个原子任务（设计语言统一收口）。按 `client/` 参考设计重写主窗口布局与样式。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（`progress/TECH-DEBT.md` TD-06） |
| 分支 | feat/TD-06-07-08 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-08-23 |
| 关联 | M6-01（布局）/M6-02（运行页）/M6-09（审计页）/M6-07（浮窗） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/main/styles.css` | 全量重写：`body{overflow:hidden}`、`.app{height:100vh}` 固定网格（236px 侧栏 / 68px 顶栏）、`article` 唯一滚动容器、`.page-fluid` 全高变体；对齐 client/ 设计令牌（--ink/--muted/--line/--blue 等）与卡片/导航/按钮/badge；`.persona-content` 与 `.workflow pre` 自动换行；删除死 CSS（`.app.maximized`/`.toast`/`.dev-label` 等） |
| `src/renderer/main/App.tsx` | 增 `screen:'welcome'\|'workspace'`；顶栏账户 chip + 退出；`article` 对审计页挂 `page-fluid` |
| `src/renderer/main/pages/WelcomePage.tsx`（新） | mock 登录入口：左品牌文案 + 右 400px 登录面板；无边框窗口自带 3 窗口控制点 + 拖拽区；无账户校验 |
| `src/renderer/main/pages/AuditPage.tsx` | `PAGE_SIZE` 50→20；根节点改 `.audit-page` 固定高度 flex；筛选栏固定 + `.audit-body` 双栏各自滚动；WorkflowPanel 用 `.reason-badge`/`.transition-head` 富样式；隐私门禁分支独立 padding 容器 |
| `src/main/windows/OverlayWindow.ts` | 建窗后 `setAlwaysOnTop(true,'screen-saver')` 提升置顶层级（仅主进程行为，renderer 样式不动） |
| `tests/e2e/T-OVR-001-overlay-window.test.ts` | mock 补 `setAlwaysOnTop: vi.fn()` |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run build:renderer` ✅ main CSS 12.10 kB 正常打包
- `npm run test:contracts` ✅ 169 passed / 0 failed
- `npm run test` ✅ 1063 passed / 5 skipped（既有 skip）

## 说明

- **布局**：顶栏/侧栏随 grid 行列固定不滚，`article`（或审计页 `.page-fluid`）独立滚动；普通页为流式卡片堆叠，无需固定高度内层。
- **登录入口**：主窗口 `frame:false`，WelcomePage 必须自带窗口控制点与拖拽区；「退出」回到登录屏，无真实校验。
- **审计体验**：列表与详情并排、各自滚动，看回放无需再上下滑；回放 `pre` 与正文均 `white-space:pre-wrap` 自动换行。
- **浮窗**：仅提升主进程窗口置顶层级（screen-saver），未改 renderer 样式、未加 slider；若压过全屏应用过度，可一行降级为默认层级。
