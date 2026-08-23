# M7-01 feedback 修订事务与 outbox

## 状态
已完成（2026-08-23），批次分支 `feat/M7-01-02-03`，M7 回流批次第一个原子任务

## 目标与范围
完成判据（路图 M7-01）：**feedback 修订、trace 当前状态、outbox job 同事务写入；revision/幂等键阻止重复**（W7、T-AUD-001）。

- **包含**：`submitLabel` 事务内派生回流 action 并写 `qdrant_sync_job`；`sync_status` 由 job 派生；`AuditStoreWorker` 新增 7 个 job 生命周期方法；`audit.submitLabel` 成功后触发 `onLabelSubmitted` 钩子；T-AUD-001 四处断言更新 + 新增 job 生命周期集成测试 + handler 钩子测试；进度文档。
- **不包含**：golden payload 构建与 Qdrant 写入（M7-02）、SET_BAD_CASE 执行（M7-03）、契约 schema 变更（本批次评估为零改动）、Qdrant sidecar 按需拉起（批次确认不做）。

## 契约与不变式（依据 DATA §4.3 / ARCH §4.3 / CONTRACT §3 / ATLAS §8.3）
- 回流触发：CORRECTED → UPSERT；(ACCEPTED 且 score≥85) → UPSERT；(REJECTED 且无修正且 golden 直出源) → SET_BAD_CASE；其余（低分认可、pre_set/LLM 拒绝）→ 无 job、`sync_status='NOT_REQUIRED'`。
- `idempotency_key = feedbackId:revisionNo:action`，UNIQUE 阻止重复 job。
- job 状态机 `PENDING→RUNNING→SUCCEEDED/FAILED`，`FAILED→PENDING` 到达退避时间后；`sync_status` 由 job 派生，禁止独立更新。
- SET_BAD_CASE 由 migration 001 trigger 兜底：feedback 必须 REJECTED + is_bad_case=1 + source_collection='golden_set' + source_point_id 非空。

## 生产代码改动
`src/main/storage/AuditStoreWorker.ts`：
- `submitLabel`：`deriveRefluxAction({labelStatus, score, hasCorrection, source})` 判定 action；feedback 行 `sync_status` 写 `PENDING`（有 job）或 `NOT_REQUIRED`（无 job）；同一事务内 INSERT `qdrant_sync_job`（state='PENDING'、attempts=0、idempotency_key）。
- 新增 7 个方法：`claimNextSyncJob`（BEGIN IMMEDIATE + WHERE state='PENDING' 原子 claim）、`rearmEligibleSyncJobs`、`readFeedbackSyncContext`（含解密 correction）、`completeSyncJob`、`failSyncJob`（permanent 时 attempts 封顶防自动重试）、`listFailedSyncJobs`、`resetStaleRunningJobs`（崩溃恢复）。
- 新增 `decryptCorrection` 私有方法（AAD = suggestion_feedback|feedback_id|CORRECTION_JSON）。

`src/main/audit/audit-control-handlers.ts` / `audit-control-ipc.ts`：`AuditControlDeps` / `AuditControlIpcOptions` 新增 `onLabelSubmitted?` 回调，submitLabel 成功后 fire-and-forget 触发（不阻塞 IPC 返回）。

`src/main/reflux/payload-builder.ts`（新建）：`deriveRefluxAction` 纯函数（回流条件判定）。

`src/main/storage/index.ts`：导出 `PendingSyncJob` / `FailedSyncJob` / `FeedbackSyncContext`。

**架构细化（相对计划）**：job I/O 类型（`PendingSyncJob`/`FailedSyncJob`/`FeedbackSyncContext`）定义在存储层 `AuditStoreWorker.ts` 而非 `reflux/types.ts`，避免 storage→reflux 类型反向依赖；`reflux/types.ts` 仅保留 worker 自身类型（GoldenSyncWorkerOptions/GoldenSyncProcessResult，M7-02 引入）。

## 测试
- `tests/integration/T-AUD-001-audit-storage.test.ts`（更新 4 处）：
  1. ACCEPTED 90 → `jobs.n===1`、UPSERT、PENDING、idempotency_key `/…:1:UPSERT$/`、feedback sync_status PENDING；
  2. 修订 85→70 → 第一修订 PENDING、第二修订 NOT_REQUIRED、`jobs.n===1`；
  3. CORRECTED round-trip → `jobs.n===1`（UPSERT）；
  4. golden direct REJECTED → `jobs.n===1`、SET_BAD_CASE。
- `tests/integration/storage/audit-sync-jobs.test.ts`（新建，8 例）：claim 原子性、rearm + feedback 派生、complete + 防重复、fail + permanent 封顶、resetStaleRunningJobs、UNIQUE 幂等键、trigger 拒绝非法 SET_BAD_CASE、CORRECTED golden-direct 发 UPSERT 而非 SET_BAD_CASE。
- `tests/unit/audit/audit-submit-label-handlers.test.ts`（扩展）：`onLabelSubmitted` 成功时触发、非法请求时不触发。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：909 passed / 15 todo（todo 与 2 个 skip 均为既有，与 M7-01 无关）

## 已知限制 / 后续依赖
- M7-01 只写 job，不执行回流；UPSERT/SET_BAD_CASE 执行在 M7-02/03。
- 本批次确认不做 Qdrant sidecar 按需拉起：Qdrant 不可达时 job 滞留 PENDING（不烧 attempts）或 FAILED（退避重试），待 Qdrant 恢复由 worker 处理（M7-02）。
- `audit.submitLabel` 的 `onLabelSubmitted` 钩子当前无接线（回调为空），M7-02 接入 `goldenSync.processPending`。
