# WP-2：弹幕 FIFO 排队 + 运行机制设置（契约/机制部分）

> 综合实施计划第三个工作包。浮窗展示期间支持按 FIFO 排队补发（默认关、超时默认 30s），覆盖 PRD「绝不排队补发」。运行机制设置的 UI 区块随 WP-4 系统设置页落地。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 综合计划 WP-2（覆盖 PRD §4「绝不排队补发」的有意修改） |
| 分支 | feat/contracts-settings（同批，PR #64） |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |
| 关联 | WP-0（`settings.queueing` 契约）、WP-4（系统设置页运行机制区块） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/storage/MigrationRunner.ts` | 支持 `-- self-transaction` 迁移标记（表重建需在事务外切 `PRAGMA foreign_keys`，与 Runner 外层事务冲突）；自管事务迁移后重断言 `foreign_keys=ON` |
| `docs/06-data-interface/migrations/002_queue_timeout_reason.sql`（新） | `audit_transition.reason_code` CHECK 增加 `QUEUE_TIMEOUT`（SQLite 不能 ALTER CHECK → 表重建；`foreign_keys=OFF` 期间 DROP + RENAME，自带事务保护数据） |
| `src/main/service/create-controller.ts` | `CreateServiceControllerOptions.migrationPath` → `migrations: MigrationFile[]`；orchestrator deps 增加 `getQueueing`（读 `settings.queueing`，缺省 null） |
| `src/main/index.ts` | 传入迁移数组（001 + 002） |
| `electron-builder.yml` | extraResources 增加 002 迁移文件 |
| `src/main/suggestion/{types,SuggestionAttemptOrchestrator}.ts` | deps `getQueueing?`；`startSession` 冻结 + 关残留队列；`endSession`/`abortAll` 关队列；DISPLAYING 分支可入队（满则 DISPLAY_WINDOW_ACTIVE 丢弃）；抽取 `continueFromNormalized`（入队评论与实时路径共用）；`finishDisplay` 尾部 `drainQueue`（过期 QUEUE_TIMEOUT / FIFO 提升首个，重锚 windowVersion+新鲜度）；`QUEUE_MAX=50` |
| `tests/integration/storage/migration-runner.test.ts` | +1（002 重建：QUEUE_TIMEOUT 可写、旧数据保留、未知 reason 拒绝、FK 仍开启） |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | +4（入队后展示结束提升、超时 QUEUE_TIMEOUT、FIFO 首条优先、队列满丢弃） |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 182 passed / 0 failed
- `npm run test` ✅ 1106 passed / 5 skipped（既有 skip）
- `npm run build` ✅

## 说明

- **入队审计**：DISPLAYING 期入队的评论立即审计 `RECEIVED→NORMALIZED`，不悬挂；提升时继续安全过滤→路由→检索；过期/关闭时 `NORMALIZED→DISCARDED(QUEUE_TIMEOUT/… )` 收尾。
- **新鲜度重锚**：提升评论 `receivedMonotonicMs = now`、`windowVersion = 当前版本`，避免 `STALE_WINDOW`/`DEADLINE_EXCEEDED` 误杀；审计 `receivedAt` 保留原值。
- **迁移风险**：002 为自管事务表重建；MigrationRunner 检测 `-- self-transaction` 标记跳过外层事务，并在迁移后重断言 `foreign_keys=ON`。
- **UI 待办**：系统设置页「运行机制」区块（排队开关 + 超时）随 WP-4 页面重构落地；`settings.queueing` 已可由 `config.update` 持久化。
