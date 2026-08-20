# Echocue UI 静态交互原型

这是可由浏览器、Claude Code、Codex 或普通开发环境直接读取和运行的 Vite + React + TypeScript 原型。它不接入 Electron、真实 API、SQLite、Qdrant 或 WebSocket；所有内容是 mock 数据。

## 运行

```bash
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址。`npm run build` 用于类型检查和静态构建。

## 范围与复用边界

- 所有 MVP 一级入口均可通过左侧导航切换；另有“直播浮窗（原型）”独立审查页。该入口仅为静态原型演示，正式产品中的浮窗应由 Electron 作为独立置顶窗口创建，不属于主窗口导航。
- 视觉/文案来自 `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md`；该文档仍是交互与验收契约。
- 正式 Renderer 可以复用页面拆分、数据类型方向和布局结构，但必须替换 mock 数据为受限 IPC 调用；不得把 API Key、WS、数据库或模型调用放进 renderer。
