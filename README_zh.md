# Echocue

[![Electron](https://img.shields.io/badge/Electron-35-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933.svg)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/testing-Vitest-6E9F18.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENCE)

[English](README.md) | 简体中文

Echocue 是一款面向抖音直播主播与运营团队的 Windows 独立桌面应用（Electron + React + TypeScript）。
它将实时弹幕转化为更快、与人设一致的回复建议：从 WebSocket 帧到达，到置顶浮窗渲染出建议，端到端 P95 时延**目标**不超过 3 秒。

每条消息都流经同一条可审计、可取消的单通道流水线：安全过滤 → 人设路由 → Qdrant（BM25）检索 → 可选 LLM 生成 → 浮窗展示。
同一时刻只进行一次建议尝试；建议展示期间收到的新消息直接丢弃，不排队。

## 典型场景

- 主播在忙碌的直播间里想快速获得自然、贴切的回复建议，不必离开直播界面。
- 团队希望回复始终与每个成员的人设以及直播间语气保持一致。
- 运营希望有一套结构化、可追溯的直播互动辅助流程，包括复核与打标。

## MVP 路线图

- [x] M0 工程基线与契约 — Electron + Vite + React + TypeScript 工程、共享 Zod 契约包、分层测试骨架、锁定依赖与许可证/SBOM。
- [x] M1 本机基础设施 — `settings.json` 配置仓库、safeStorage 凭证、AES-GCM/HMAC/DPAPI 加密、SQLite 审计 worker、主窗口/托盘壳层、匿名化遥测。
- [x] M2 人设、安全与路由 — 成员/别名 CRUD、人设草稿/发布/回滚、安全规则编译器、弹幕规范化与成员路由。
- [x] M3 Qdrant 与 BM25 — 随包 Qdrant sidecar、jieba-BM25 流水线、`pre_set`/`golden_set` 双库检索及 calibration 与跨库 rerank。
- [x] M4 douyinLive 接入与状态机 — 随包 douyinLive sidecar、本地 WebSocket adapter、lifecycle/activity 状态机。
- [x] M5 Provider 与实时编排 — Provider 配置/连接测试、稳定的 `TextGenerationProvider`、DeepSeek 与 OpenAI-compatible 双 adapter、确定性 PromptAssembler、实时 `SuggestionAttempt` 编排。
- [x] M6 正式 Renderer 与独立浮窗 — 七个正式功能入口与独立置顶浮窗。
- [x] M7 回流、集成、验收与发布 — `golden_set` 回流闭环、集成/E2E 验收、Windows 打包与签核。

### 总体架构

| 模块 | 职责 |
| --- | --- |
| `douyin` | 管理随包 douyinLive sidecar，并将本地 WebSocket 事件映射为 `SourceComment` 事件。 |
| `safety` | 弹幕规范化，应用输入安全规则（风险/PII/禁忌），在检索或模型调用前完成过滤。 |
| `persona` | 团队成员、名称与别名；人设草稿、发布、比较与回滚；绑定版本的成员路由。 |
| `retrieval` | 随包 Qdrant sidecar、jieba-BM25 流水线、`pre_set`/`golden_set` 双路查询 adapter，含 calibration 与跨库 rerank。 |
| `provider` | 稳定的 `TextGenerationProvider` 接口，含 DeepSeek 与 OpenAI-compatible 两个 adapter。 |
| `prompt` | 确定性 `PromptAssembler` — 固定消息布局、注入隔离、版本化模板与确定性截断。 |
| `service` | `ServiceStateMachine`（lifecycle/activity）与单次 `SuggestionAttempt` 编排，全程 trace 审计。 |
| `storage` | SQLite `AuditStoreWorker` 单写模型，字段级 AES-GCM 加密与哈希链。 |
| `telemetry` | 匿名化 Prometheus / OpenTelemetry 指标、日志与诊断 — 不含消息原文、人设文本、API Key 或 `trace_id`。 |
| `windows` | 主窗口（三按钮 + 托盘）与置顶浮窗。 |

## 环境要求

- 目标平台为 Windows x64；Linux 用于开发与 CI。
- Node.js 22+
- npm
- douyinLive 与 Qdrant 二进制随包存放在 `assets/`，运行期不下载任何二进制。

## 快速开始

安装依赖：

```bash
npm install
```

以开发模式运行（watch 构建 main 与 preload，并启动 renderer dev server）：

```bash
npm run dev
```

或构建并启动 Electron 生产包：

```bash
npm run preview
```

验证构建与测试套件：

```bash
npm run typecheck
npm run test:contracts
npm test
```

### UI 原型（纯静态，不接 Electron）

```bash
cd prototype
npm install
npm run dev
```

原型仅使用 mock 数据演示页面布局与交互模式。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | watch 构建 main/preload 并启动 renderer dev server |
| `npm run build` | 生产构建 main、preload 与 renderer |
| `npm run start` | 从构建产物启动 Electron |
| `npm run preview` | `build` + `start` |
| `npm run typecheck` | main 进程与 node 配置类型检查（`tsc --noEmit`） |
| `npm test` | 运行完整 Vitest 套件 |
| `npm run test:unit` | 单元测试（纯逻辑） |
| `npm run test:contract` | 契约层测试 |
| `npm run test:contracts` | 共享契约 schema + fixture 测试 |
| `npm run test:integration` | 集成测试（SQLite / Qdrant / 文件系统） |
| `npm run test:e2e` | E2E 测试（mock 外部服务） |
| `npm run test:coverage` | 带覆盖率报告的测试 |
| `npm run benchmark:safety-routing` | 基于版本化样本的安全/路由基准测试 |
| `npm run license:check` | 依赖许可证策略检查 |
| `npm run sbom` | 生成 CycloneDX SBOM |
| `npm run compliance` | `license:check` + `sbom` |

## CI

GitHub Actions（`.github/workflows/test-windows.yml`）在每次 push/PR（`master`、`develop`）时于 Windows 上运行：
契约、单元、契约层、集成与 E2E 测试，`typecheck`，许可证检查与 SBOM 生成，并上传合规产物。

## 仓库结构

```
src/contracts/   共享 Zod 契约包 — 全进程权威类型
src/main/        Electron 主进程（配置、加密、存储、安全、人设、检索、Provider、服务、窗口、遥测）
src/preload/     Preload 脚本（严格 IPC 白名单）
src/renderer/    React 渲染进程（主窗口 + 浮窗）
tests/           单元 / 契约 / 集成 / E2E 测试套件
docs/            需求、产品、架构、数据契约、设计与实施文档
prototype/       静态 React UI 原型（仅 mock 数据）
assets/          随包 sidecar 二进制（douyinLive、Qdrant）
```

## 文档

权威项目文档位于 `docs/`，覆盖需求（`01-requirements`）、产品（`02-product`）、技术调研（`03-research`）、
架构（`04-architecture`）、数据接口（`06-data-interface`）、评审（`07-review`）、交付/路线图（`08-delivery`）、
详细设计（`09-design`）、UI（`10-ui`）与实施（`11-implementation`）。
`docs/06-data-interface/schema/contracts-v1.ts` 中的机器可读 Zod schema 是全部共享类型的唯一事实来源。

## License

本项目基于 [Apache License 2.0](LICENSE) 开源。

---

**题外话**

1. 项目的所有需求分析和设计、MVP、里程碑等文档（见 `docs/` ）完整提交 Github，未作任何删减，供其他同好交流学习用。
2. 项目完全采用 Vibe Coding，我几乎没怎么 CR。所有子任务进度档也完整提交（见 `progress/`），方便后续 Coding Harness 交流鉴。
3. UI 原型在目录 `prototype/` 下，实际产品 UI 与初版设计有**大出入**，这里仅供参考。
4. EXE 使用方式很简单，试试就会了，我就没有单独写操作指引文了。
5. 本项目派生自 [Douyin-EchoCue](https://github.com/Ahsen17/Douyin-EchoCue)，项目已 **ARCHIVED**，具体原因可见该项目 Issue。

**特别鸣谢：** 

[douyinLive](https://github.com/Ahsen17/douyinLive)

@[jwwsjlm](https://github.com/jwwsjlm)
