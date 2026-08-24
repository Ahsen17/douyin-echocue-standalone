# LLM 调用时间窗口 5s → 10s

> 将单次 LLM 调用允许的保险上限从 5 秒放宽到 10 秒，给真实 Provider 生成留足余量。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 运行时参数校准（非设计调整） |
| 分支 | feat/llm-timeout-10s |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-25 |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | `PROVIDER_TIMEOUT_MS` 5000→10000；`T0_FRESHNESS_BUDGET_MS` 5000→10000；`SELECTED_BUDGET_MS` 2500→10000；`WINDOW_MAX_AGE_MS` 5000→10000；注释同步 |
| `src/main/service/create-controller.ts` | `windowMaxAgeMs` 硬编码 5000→10000 |
| `src/main/config/SettingsStore.ts` | 默认 `windowMaxAgeMs` 5000→10000 |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | M5-08 精确截止断言 6000/3700→11000；mid-LLM 释放 now=5000→12000；harness 注释同步 |
| 文档（需求/调研/架构/LLM 设计/部署手册） | 「Provider 5 秒」→「10 秒」 |

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1157 passed / 5 skipped
- `npm run build` ✅

## 说明

- **新鲜度截止**是 `min(t0+预算, selected+预算, t0+windowMaxAge)`，任一项偏小都会截断整体——因此 Provider 硬超时、t0 上限、选中后预算、窗口驻留四者同步提到 10s。
- 10s 为**安全上限**，非目标时延；E2E P95 ≤3s 目标不变。
- 语义变化：`SELECTED_BUDGET_MS` 现与 `T0` 相等（`now ≥ t0` 时 t0 项更紧，selection 项不再收紧），t0 上限成为绑定约束。
- 用户本地 CR 已确认；本次按 rules 规范流程提交（此前改动未提交）。
