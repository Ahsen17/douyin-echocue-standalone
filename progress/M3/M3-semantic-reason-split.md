# M3-semantic-reason-split 审计追溯语义枚举扩展

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M3-semantic-reason-split（路图外插入任务） |
| 任务名称 | 审计追溯语义枚举扩展：LOW_VALUE 收敛为仅 low_value 类语义初筛 |
| 状态 | ⏳ 已完成，待审查（批次：feat/M3-semantic-reason-calibration-config） |
| 完成时间 | 2026-08-31 |
| 分支 | feat/M3-semantic-reason-calibration-config |
| 背景 | 原 LOW_VALUE 被重载为 6 类结果（语义初筛/窗口淘汰/检索失败/路由不可用/管线兜底），审计回放无法区分；方案 B 拆分为独立 reason |

## 改动摘要

`TraceReasonCodeV1` 由 26 增至 31，新增 5 个 reason：

| reason | 语义 | 终态转移 |
|---|---|---|
| `FILTER_RISK_DISCARD` | 语义初筛丢弃（`discardedBy='filter_risk'`） | `RETRIEVING→DISCARDED` |
| `WINDOW_EVICTED` | 候选窗口淘汰（过期/上限/清空，未选中） | `RETRIEVING→DISCARDED` |
| `RETRIEVAL_FAILED` | Qdrant 检索异常，无 hits | `RETRIEVING→DISCARDED` |
| `PERSONA_ROUTE_UNAVAILABLE` | 人设路由/版本读取抛错，fail-closed | `NORMALIZED→DISCARDED` |
| `PIPELINE_ERROR` | 管线未预期异常兜底关闭 | 所有 `DISCARDED` 出边 |

不变量：`LOW_VALUE` ⇔ `discardedBy='low_value'` 的语义初筛丢弃；`FILTER_RISK_DISCARD` ⇔ `discardedBy='filter_risk'`；二者终态转移必带 `GOLDEN_QUERY_RESULT`/`PRE_QUERY_RESULT`/`RERANK_DECISION` 快照。历史 LOW_VALUE 数据不回溯改写。

## 产出文件

- `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts`（镜像同步）— `TraceReasonCodeV1Schema` 追加 5 值
- `src/main/retrieval/semantic-filter.ts` — DISCARD 返回按 `discardedBy` 分流 `FILTER_RISK_DISCARD`/`LOW_VALUE`
- `src/main/suggestion/SuggestionAttemptOrchestrator.ts` — 5 处调用点：`onEvict→WINDOW_EVICTED`、路由不可用→`PERSONA_ROUTE_UNAVAILABLE`、检索失败→`RETRIEVAL_FAILED`、语义丢弃→`semanticDecision.reason`（FINAL_REASON 补 `discardedBy`/`topSemanticType`）、`handlePipelineError→PIPELINE_ERROR`
- `docs/06-data-interface/migrations/004_semantic_reason_codes.sql`（新）— 表重建，CHECK 31 值全量
- `src/main/index.ts` — migrations 数组注册 v4；`electron-builder.yml` — extraResources 追加 004
- `docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md` — reason 类型枚举、DDL CHECK、状态机表（新增"兜底类 reason"说明）
- 测试：`tests/unit/retrieval/semantic-filter.test.ts`（filter_risk 断言补 `FILTER_RISK_DISCARD`）、`tests/integration/storage/migration-runner.test.ts`（004 注册 + 全枚举 drift 守护）

## 测试与验证

- `npm run typecheck` ✅
- `npm run test:contracts` — 201 passed ✅
- `npm run test` — 1210 passed / 5 skipped（既有 skip）✅

## 遗留/待办

- 批次内 Task 2（置信度参数配置化）未开始，完成后再批次级验证（`npm run build`）。
- 迁移 004 在旧库（含历史 LOW_VALUE 行）上的 INSERT SELECT 保序性由 migration-runner 覆盖。
