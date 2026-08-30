# WP-3：审计回放保留期（默认 30 天，7–180 可调）

> 综合实施计划第四个工作包。完整回放记录不再无限保存：到期自动清理，默认保留 30 天、可调 7–180 天；**当天首次运行 App 时清理一次**（用户修订的触发时机）。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 综合计划 WP-3 |
| 分支 | feat/contracts-settings（同批，PR #64） |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |
| 关联 | WP-0（`settings.audit.retentionDays` 契约）、WP-4（系统设置页「数据与保留」区块 UI） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/storage/AuditStoreWorker.ts` | 新增 `pruneTracesOlderThan(cutoffIso)`：单事务按 FK 顺序级联删除过期完整 trace（audit_reference → 孤儿 snapshot → audit_transition → qdrant_sync_job → suggestion_feedback → audit_trace → 空 live_session）；子查询避免大 IN 列表；`completed_at` 为 NULL 的进行中 trace 永不删除 |
| `src/main/storage/retention-scheduler.ts`（新） | `RetentionScheduler.runOnce()`：当天首次运行清理一次（持久化 `lastPrunedDay` 于状态文件）；保留期 clamp 7–180（缺省 30）；服务 RUNNING 时跳过；best-effort 不致命 |
| `src/main/storage/index.ts` | 导出 RetentionScheduler |
| `src/main/index.ts` | app ready 后构造调度器并 `runOnce()`（`isStopped` 为 boot 时的 STOPPED 状态），失败仅记日志 |
| `tests/integration/storage/audit-prune.test.ts`（新） | +2：过期 trace 级联删除（快照/引用）且保留近期与进行中、剪枝后 `verifyIntegrity` 通过；空库 no-op |
| `tests/unit/storage/retention-scheduler.test.ts`（新） | +3：当天首次清理+同日跳过+状态落盘；RUNNING 延迟；clamp 7/180/默认 30 |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 182 passed / 0 failed
- `npm run test` ✅ 1111 passed / 5 skipped（既有 skip）
- `npm run build` ✅

## 说明

- **HMAC 链安全**：只删整条完整 trace（每 trace 链独立），`verifyIntegrity` 对剩余链仍通过（测试覆盖）。
- **触发时机**：按用户修订为「当天首次运行 Application 时自动清理」——状态文件持久化上次清理日期，同日重启跳过；不做 24h 后台定时。
- **FK 顺序**：先删引用再删快照；孤儿快照判定「不再被任何引用」即删除（每个 snapshot 必被引用一次）。
- **UI 待办**：系统设置页「数据与保留」区块（7–180 数字输入，默认 30）随 WP-4 落地；`settings.audit.retentionDays` 已可由 `config.update` 持久化。
