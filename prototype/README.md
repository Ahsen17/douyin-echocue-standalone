# Echocue UI 静态交互原型

这是可由浏览器、Claude Code、Codex 或普通开发环境直接读取和运行的 Vite + React + TypeScript 原型。它不接入 Electron、真实 API、SQLite、Qdrant 或 WebSocket；所有内容是 mock 数据。

## 运行

```bash
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址。`npm run build` 用于类型检查和静态构建。

## 范围与复用边界

- 七个 MVP 主窗口一级入口均可通过左侧导航切换；“直播浮窗（独立窗口）”位于明确标注的“原型辅助”区域，只用于独立窗口审查，正式产品不把它放入主导航。
- 运行、直播间/AI、人设、偏好、诊断、审计和打标均提供 UI 契约 §9 所需的空/加载/错误或隐私 fixture；配置、人设版本、偏好、审计上下文与打标修订均有本地交互。三个窗口按钮只模拟语义并提供 tooltip/可访问名，不控制真实操作系统窗口。
- 原型包含 mock Provider 配置，但不默认绑定供应商；用户可见字段统一为“服务商名称、Base URL、Model ID、API Key”。
- 视觉/文案来自 `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md`；该文档仍是交互与验收契约。
- 正式 Renderer 可以复用页面拆分、数据类型方向和布局结构，但必须替换 mock 数据为受限 IPC 调用；不得把 API Key、WS、数据库或模型调用放进 renderer。
