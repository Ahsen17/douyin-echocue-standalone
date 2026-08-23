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

## 批次审查（第一轮，非 fork Subagent，e0121d2→d61df5a）
审查结论：**无阻断级问题**；10 个维度（事务完整性、幂等、回流触发矩阵、job 状态机、payload 契约、profile 读取路径、bad-case 作用域、并发/崩溃恢复、安全红线、兼容性）全部通过。

**已修复**：
- IMP-2：区分 Qdrant 瞬时不可达（PENDING 不烧 attempts）与 golden_set 元数据配置错误（改为永久失败可观察，不再静默空转）；补 config-error 单测。
- IMP-1：`failSyncJob` 注释如实说明永久失败无自动恢复路径（MVP 无诊断 IPC，需人工 SQLite/Qdrant 干预）。
- IMP-3：`backoffMs` 注释说明退避受 sweep 周期主导（<60s 的退避等效于下个 sweep 重试）。
- IMP-4：补全闭环集成测试（fail→re-arm→retry→synced）。
- SUG-4：`decryptCorrection` 区分空 envelope 与解密/解析失败（抛 RefluxPayloadError，不再掩盖为「无 correction」）。

**留档（已知限制，未在本批次实施）**：
- 永久 FAILED job 无用户可见恢复入口（诊断 IPC 留待后续诊断页增强）。
- 重试会刷新 golden point 的 `created_at`（`buildGoldenSetPayload` 用同步时刻；确定性 point_id 保证幂等，时间戳反映最后成功同步）。
- 基础设施错误 `last_error` 仅存错误类名（安全红线：不回显 Qdrant 请求体），排查价值有限，后续可补匿名非回显错误码（如 HTTP status）。
- `onLabelSubmitted` 与 sweep 重叠时新 job 最多延迟一个 sweep 周期（60s）。
- 生产接线缺口（既有依赖，非本批次引入）：`bootstrapPreSet` 尚未接线到生产运行时，`golden_set` 在 bootstrap 落地前不存在，回流 worker 将保持 PENDING（前向兼容不烧 attempts），需在 retrieval bootstrap 接线后联动验证端到端回流。

## 批次级验证结果（修复后）
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：945 passed / 15 todo（2 个 skip 为既有 Windows/E2E）
- `npm run build`：成功
