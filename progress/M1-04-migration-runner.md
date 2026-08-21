# M1-04 SQLite Migration Runner

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M1-04 |
| 任务名称 | 实现 SQLite migration runner |
| 状态 | ✅ 已完成 |
| 完成时间 | 2026-08-21 |
| 分支 | feat/M1-04-05 |

## 产出文件

- `src/main/storage/MigrationRunner.ts` — migration runner 核心
- `src/main/storage/index.ts` — 导出入口
- `tests/integration/storage/migration-runner.test.ts` — 5 项集成测试
- `tests/setup/node-sqlite-compat.cjs` — node:sqlite Vite/Vitest compat shim
- `vitest.config.ts` — 更新 resolve.alias 支持 node:sqlite

## 实现说明

### 运行方法
```ts
import { MigrationRunner } from './src/main/storage/index.js';
const runner = new MigrationRunner(dbPath, [{ version: 1, path: '/path/to/001_initial_schema.sql' }]);
const db = runner.run(); // 返回已迁移的 DatabaseSync 实例
```

### 测试命令
```bash
npm run typecheck
npm run test:contracts
npm test -- tests/integration/storage/migration-runner.test.ts
```

## 完成标准验收

- [x] 空库初始化：所有表/触发器/索引创建成功，schema_migration 行写入
- [x] 重复启动幂等：second run 不新增 schema_migration 行
- [x] checksum 篡改：抛出 checksum mismatch 异常，DB 保持原状
- [x] 坏 SQL 回滚：事务内 DDL 失败后 ROLLBACK，DB 无脏数据
- [x] foreign_keys/WAL/触发器：主键冲突触发器（一主播唯一）验证通过

## 关键不变量

- 失败时 DB 关闭并抛异常，调用方必须视为启动阻断
- 同一 migration version 不可更改 SQL 内容（checksum 保护）

## 已知限制

- WAL checkpoint 行为由 SQLite 自动管理，未额外封装
- 容量检查（2 GiB 门禁）由 AuditStoreWorker 实现（M1-05）

## 追溯

- Testcase: T-STO-001, T-AUD-001
- Acceptance: A-07
