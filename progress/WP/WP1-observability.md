# WP-1：监控指标 + /metrics 端点 + 监控诊断展示（TD-03 落实）

> 综合实施计划第二个工作包。`EchocueMetrics`/`initOtel` 由「只定义未接线」落地为真实监控：Prometheus 指标集、按会话统计、回环 `/metrics` 端点与监控诊断页展示。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（`progress/TECH-DEBT.md` TD-03）+ 综合计划 WP-1 |
| 分支 | feat/contracts-settings（与 WP-0 同批，PR #64） |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |
| 关联 | WP-0（契约）、WP-4（监控诊断页归入新导航） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/telemetry/Metrics.ts` | 重写指标集：`commentReceived/commentFiltered{category}/commentSemanticType{semantic_type}/commentDiscarded{reason}/suggestionResult{result}/overlayDisplayed/llmRequests/llmErrors{error_type}/sidecarCrashes{kind}` + 直方图 `llmLatencyMs/e2eLatencyMs/retrievalLatencyMs`；保留 `metricsText()` |
| `src/main/telemetry/SessionMetrics.ts`（新） | 按会话累计：reset(启动)/freeze(停止冻结最近一次)/record*/snapshot；LLM 平均时延运行均值、E2E P95 有界采样 |
| `src/main/telemetry/MetricsHub.ts`（新） | 门面：Prometheus + SessionMetrics + /metrics server；record 方法全为枚举 label |
| `src/main/telemetry/metrics-server.ts`（新） | Node http 回环端点（仅 127.0.0.1），`/metrics` + `/health`；`getBoundAddress()` 供测试 |
| `src/main/telemetry/monitoring-control-{handlers,ipc}.ts`（新） | `monitoring.getSessionMetrics` IPC（主窗口 trusted sender） |
| `src/main/telemetry/index.ts` | 导出新模块 |
| `src/main/suggestion/{types,SuggestionAttemptOrchestrator}.ts` | deps 增加 5 个 observability hooks；过滤/检索/语义类型/LLM 请求各点接线（匿名） |
| `src/main/service/create-controller.ts` | 构造 MetricsHub（端口取 settings.metrics）；hooks 接线；createLiveSession reset、cleanupOnStop freeze；返回 metricsHub |
| `src/main/index.ts` | app ready 后 `startServer()` + wireMonitoringControl；doQuit `stopServer()` |
| `src/preload/main-preload.ts` | 暴露 `monitoring.getSessionMetrics` |
| `src/renderer/main/{diagnostics/diagnostics-logic.ts,pages/DiagnosticsPage.tsx,styles.css}` | 「直播监控数据」区块：中文标签（补充九）、会话时间范围、8 项业务指标网格、语义类型 chips |
| 测试 | metrics-privacy（重命名+新 label）、session-metrics（新）、metrics-server（新，绑 127.0.0.1）、ipc-allowlist（32 通道）、preload-surface（monitoring surface）、orchestrator hooks（+1）、diagnostics-logic（+4 中文格式化） |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 182 passed / 0 failed
- `npm run test` ✅ 1101 passed / 5 skipped（既有 skip）
- `npm run build` ✅ 渲染层打包通过

## 说明

- **指标匿名红线**：所有 label 均为枚举类别（category/semantic_type/reason/result/error_type/kind），无 `trace_id`/昵称/人设/密钥/原文；`metrics-privacy.test.ts` 持续校验。
- **按会话统计**：服务启动 `resetSession(sessionId)`，停止 `freezeSession()`——监控诊断页始终展示最近一次直播，运行中实时累计。
- **/metrics 回环**：默认 9100（`settings.metrics`，WP-0 契约），仅 `127.0.0.1`；绑定失败只降级无 HTTP，UI 监控不受影响。
- **中文命名（补充九）**：UI 展示全部用中文标签，英文指标名只出现在 `/metrics` 端点。
- **未接线 OTel 导出**：`initOtel` 仍按 ARCH §8「默认不启用 OTLP 出口」不接线；Prometheus 端点即 TD-03 修复目标。
