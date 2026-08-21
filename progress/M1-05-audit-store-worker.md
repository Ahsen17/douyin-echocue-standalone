# M1-05 AuditStoreWorker 单写模型

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M1-05 |
| 任务名称 | 实现 AuditStoreWorker 单写模型 |
| 状态 | ✅ 已完成 |
| 完成时间 | 2026-08-21 |
| 分支 | feat/M1-04-05 |

## 产出文件

- `src/main/storage/AuditStoreWorker.ts` — 核心实现
- `src/main/storage/index.ts` — 更新导出（含 AuditStoreWorker、错误类、类型）
- `tests/integration/storage/audit-store-worker.test.ts` — 8 项集成测试

## 实现说明

### 运行方法
```ts
import { AuditStoreWorker } from './src/main/storage/index.js';
const worker = new AuditStoreWorker({ dbPath, migrations, keyManager, keyVersion });
worker.createSession({ sessionId, roomReference, startedAt });
worker.createTrace({ traceId, sessionId, sourceMessageId, receivedAt });
worker.appendTransition(traceId, null, 'RECEIVED', 'EVENT_RECEIVED');
worker.close();
```

### 测试命令
```bash
npm run typecheck
npm run test:contracts
npm test -- tests/integration/storage/audit-store-worker.test.ts
```

## 完成标准验收

- [x] DB 独占：由 AuditStoreWorker 构造时通过 MigrationRunner 打开，close() 关闭
- [x] appendTransition 使用 TRACE_TRANSITIONS_V1 校验 from→to，非法转换抛 AuditStateInvalidError
- [x] HMAC 哈希链：连续 transition 的 previous_hmac = 上一条 entry_hmac，首条 null
- [x] 快照加密：envelope 为 AES-GCM BLOB，AAD 绑定 table|snapshotId|contentType
- [x] 终态（FILTERED/DISCARDED/FAILED/HIDDEN）触发 audit_trace.final_state + completed_at 更新
- [x] DB 打开失败 → AuditUnavailableError(E_AUDIT_UNAVAILABLE)
- [x] 写失败（坏 SQL 等）→ ROLLBACK + AuditUnavailableError

## 关键不变量

- appendTransition 内部是单个 SQLite 事务，失败即 ROLLBACK
- AuditStateInvalidError 不被包装为 AuditUnavailableError，调用方可区分
- 不持有 API Key，不访问网络

## 追溯

- Testcase: T-AUD-001
- Acceptance: A-07
