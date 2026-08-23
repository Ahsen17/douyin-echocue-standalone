# M7-03 golden bad-case worker

## 状态
已完成（2026-08-23），批次分支 `feat/M7-01-02-03`，M7 回流批次第三个原子任务

## 目标与范围
完成判据（路图 M7-03）：**仅「拒绝且无修正」且本次为 golden 直出的源 point 标坏；pre_set/LLM 路径绝不修改任何 point**（W7、T-RET-001、A-05）。

- **包含**：`GoldenSyncWorker` SET_BAD_CASE 分支（校验源为 golden_set + pointId 非空 → `setPayload is_bad_case=true` → complete 带源 point id）；无 golden 直出源 → `RefluxPayloadError` 永久失败；worker 单测 +2、真实 Qdrant 集成 +1；进度文档。
- **不包含**：回流判定（`deriveRefluxAction` SET_BAD_CASE 判定在 M7-01 已建）；trigger 校验（migration 001 已存在，M7-01 已测试）；契约 schema 变更（零改动）。

## 契约与不变式
- SET_BAD_CASE 仅对 `source_collection='golden_set'` 且 `source_point_id` 非空的 REJECTED 无修正反馈（`deriveRefluxAction` 判定 + migration trigger 插入时兜底双保险）。
- bad case 仅排除该 golden point 本身（payload `is_bad_case=true`，被检索 filter `enabled=true AND is_bad_case=false` 排除），不推断/屏蔽语义相似案例；pre_set/LLM 路径无源 point，绝不可能标坏（CONTRACT §4.3）。
- 数据错误（缺源）→ 永久失败（attempts 封顶，不自动重试），人工修复可重试。

## 生产代码改动
`src/main/reflux/GoldenSyncWorker.ts`：`processOne` 的 `SET_BAD_CASE` 分支：
1. `ctx.source.collection !== 'golden_set' || ctx.source.pointId === null` → `RefluxPayloadError`（永久失败）；
2. `client.setPayload('golden_set', { wait:true, payload:{ is_bad_case:true, updated_at }, points:[source.pointId] })`；
3. `completeSyncJob(jobId, feedbackId, source.pointId)`（feedback SYNCED + target_point_id = 源 point id）。

## 测试
- `tests/unit/reflux/golden-sync-worker.test.ts`（+2，共 10）：SET_BAD_CASE 端到端（setPayload 带 is_bad_case:true + points 源 id，complete 带源 id，不触发 upsert）；缺 golden 源 → 永久失败（permanent=true）。
- `tests/integration/reflux/golden-sync-worker.test.ts`（+1，共 5，真实 Qdrant）：预置 golden point → 直出 trace（DIRECT_DECISION.pointId 指向它）→ REJECTED → processPending → 该点 `is_bad_case=true`、updated_at 刷新；`SuggestionRetriever.search` 按 persona filter 不再返回该点（被排除）。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：943 passed / 15 todo（2 个 skip 为既有 Windows/E2E）

## 已知限制 / 后续依赖
- 回流链路闭环（M7-01 outbox → M7-02 UPSERT → M7-03 bad-case）在批次级集成验证（M7-04 全量 Contract/Integration tests 之外）已由本批次集成测试覆盖。
- 批次级验证与 Subagent 审查待执行。
