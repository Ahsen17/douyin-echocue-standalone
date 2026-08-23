# M7-07 容量、WAL、完整性与恢复演练

## 状态
⏳ 待审查（2026-08-23），批次分支 `feat/M7-07`，M7 集成验证批次第三个原子任务（单独一批）

## 目标与范围
完成判据（路图 M7-07）：**每千条增长量、2 GiB 启动门槛、低空间预警、256 MiB 停服、WAL checkpoint、释放空间后完整性检查与受控本机恢复演练通过**（T-STO-001、A-12；RUNBOOK §5.3/§8.3；DATA §8.2）。

- **包含**：补生产能力（容量门槛与周期监控、WAL checkpoint、完整性检查、受控备份/恢复）+ 以 T-STO-001 演练验证；2 GiB 启动门槛接线到 service gate、256 MiB 周期停服接线到 ServiceController、`AuditStoreWorker.close()` 前置受控 checkpoint、`verifyIntegrity()` HMAC 链锚点重算、`backupTo()` VACUUM INTO 一致性快照 + 恢复后只读验证、每千条增长量实测留档。
- **不包含**：契约/migration/IPC 任何改动（`E_STORAGE_LOW`/`AUDIT_UNAVAILABLE` 已存在）；真实磁盘耗尽演练（测试全部注入 mock `readStorage`，避免依赖真实磁盘空间/CI 波动）；Windows 安装 E2E（M7-08）；真实房间时延/质量 POC（M7-06）。

## 设计决策
1. **受控 checkpoint**：`AuditStoreWorker.checkpoint()` 执行 `PRAGMA wal_checkpoint(TRUNCATE)`；`close()` 先 checkpoint 再 `db.close()`。TRUNCATE 把已提交帧刷入主库文件并清空 `-wal`（实测：checkpoint 后 `-wal` 0 字节、close 后 `-wal` 文件移除），停服后留下单一一致文件。
2. **完整性检查 = 结构 + 内容链**：`verifyIntegrity()` 三步——`PRAGMA integrity_check` = ok、`schema_migration` 最高版本存在、逐条 transition 用生产同公式 `computeTransitionHmac` 重算 `entry_hmac` 并与库中比对。任何不匹配抛 `AuditUnavailableError`（数据不可信 → 停服语义，RUNBOOK §5.3）。
3. **受控备份/恢复**：`backupTo(targetPath)` 用 `VACUUM INTO` 对**只读独立连接**生成一致性快照（worker 已关闭、无并发写，符合 RUNBOOK §8.3「服务完全停止、正常关闭并完成一致性 checkpoint 后」）；恢复 = 从备份重建 → 只读验证（migration 版本、HMAC 链、trace 可读）。`VACUUM INTO` 在只读连接上经实测可用（node v24 / node:sqlite）。
4. **容量门槛接线**：
   - 启动门槛（≥ 2 GiB）：`ServiceGateChecks` 新增 `isStorageReady()`，`createServiceGateChecks` 注入 `readStorage`（复用 `create-controller.ts` 既有 `statfsSync` 闭包）；可用 < `STARTUP_MIN_BYTES` → gate 返回 `E_STORAGE_LOW`，服务不启动。
   - 周期监控（60 s）：新 `StorageMonitor`（`src/main/storage/storage-monitor.ts`），`check()` 读可用字节 < `CRITICAL_MIN_BYTES`(256 MiB) → `onCritical`；由 `ServiceController` 在 `RUNNING` 后 `start()`、`performStop()` 时 `stop()`（幂等），`onCritical` → `controller.stop('AUDIT_UNAVAILABLE')`（与 `onAuditFailure` 同模式）。
   - 预警（1 GiB 或卷 10%）由既有 `DiagnosticsSource.storageLowSpace` 承担，不重复实现。
   - **任何阈值路径均无 DELETE/清理**（无自动删除）。
5. **测试时钟**：沿用 M7-04/05 范式——真实时钟 + 可控阈值/短间隔 + 轮询终态，不用 `vi.useFakeTimers`。增长量演练单独放宽超时（30 s，1000 trace + 逐条 HMAC）。
6. **安全红线**：演练全部用合成 trace 数据（脱敏 `source_message_id`），断言只验证字段/链/计数，不输出原文、密钥、`trace_id`。

## 生产代码改动
- **`src/main/storage/storage-monitor.ts`（新）**：`StorageMonitor` 类 + 常量 `STARTUP_MIN_BYTES = 2 GiB`、`CRITICAL_MIN_BYTES = 256 MiB`；`check()`/`start()`/`stop()` 幂等；`readStorage` 返回 null 时跳过检查（未知卷不触发停服）。
- **`src/main/storage/AuditStoreWorker.ts`**：
  - `checkpoint()`：`PRAGMA wal_checkpoint(TRUNCATE)`；失败抛 `AuditUnavailableError`。
  - `close()`：先 `checkpoint()` 再 `db.close()`（受控关闭）。
  - `verifyIntegrity(): IntegrityReport`：`integrity_check` + migration 版本 + `entry_hmac` 全量重算；不匹配抛 `AuditUnavailableError`。
  - `backupTo(targetPath)`：对只读独立连接执行 `VACUUM INTO`（路径单引号转义），try/finally 关闭临时连接。
- **`src/main/storage/index.ts`**：导出 `StorageMonitor`、`STARTUP_MIN_BYTES`、`CRITICAL_MIN_BYTES`、`StorageCapacity`/`StorageMonitorOptions`/`IntegrityReport` 类型。
- **`src/main/service/ServiceController.ts`**：`ServiceGateChecks` + `isStorageReady()`；`ServiceControllerOptions` + `storageMonitor?`；`runGate` 检查 `isStorageReady` 失败返回 `E_STORAGE_LOW`；`RUNNING` 后 `storageMonitor?.start()`、`performStop` 中 `stop()`。
- **`src/main/service/service-gate.ts`**：`ServiceGateDependencies` + `readStorage?`；`createServiceGateChecks` 实现 `isStorageReady`（`readStorage` 缺省 → true）。
- **`src/main/service/create-controller.ts`**：提取 `readStorage`（`statfsSync` 闭包）供 DiagnosticsSource、gate、StorageMonitor 三处复用；构造 `StorageMonitor`（`onCritical` → `controller.stop('AUDIT_UNAVAILABLE')`）传入 `ServiceController`；gate 注入 `readStorage`。

## 测试
- **填实 `tests/integration/T-STO-001-sqlite-wal.test.ts`（7 用例，替换 5 条 todo）**：
  - WAL checkpoint：写入 trace 后 `-wal` > 0 → `checkpoint()` → `-wal` = 0 → workflow 仍可读；
  - 完整性检查：正常库 `ok`；篡改 `entry_hmac` → `verifyIntegrity` 抛 `AuditUnavailableError`；
  - 受控恢复演练：写入 → checkpoint → close → `backupTo` → 破坏原库 → 从备份重建 → `verifyIntegrity` ok + trace 可读 + migration 版本 1；
  - 每千条增长量：1000 条合成 trace，实测 **≈ 1,044,480 bytes / 千条**（约 0.996 MiB/千条，留档用于剩余容量估算）；
  - 2 GiB 门槛：`createServiceGateChecks` 注入 `readStorage` < `STARTUP_MIN_BYTES` → `isStorageReady()` false；= 阈值 → true；
  - 256 MiB 停服：`StorageMonitor`（mock `readStorage` < `CRITICAL_MIN_BYTES`）接线 `ServiceController` → RUNNING 后立即触发 `onCritical` → `stop('AUDIT_UNAVAILABLE)` → `STOPPED`；
  - 无自动删除：阈值检查 + checkpoint + backup 后 trace 数与备份内容均不减少。
- **`tests/unit/service/service-controller.test.ts`**：`makeChecks` 补 `isStorageReady: async () => true`；新增「`isStorageReady=false` → gate 拒绝 → `STOPPED(SOURCE_ERROR, E_STORAGE_LOW)`」。
- **波及默认值**：`T-CON-002` 的 `allPassChecks`、`mock-stream-harness` inline `checks` 补 `isStorageReady: async () => true`（接口加方法后所有构造点同步）。
- 说明：迁移三件套（空库初始化/重复迁移/失败回滚）已在 `migration-runner.test.ts` 覆盖，T-STO-001 不再重复，聚焦容量/WAL/完整性/恢复。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：**990 passed / 5 todo / 0 failed**（含本批次 +7 用例；剩余 5 todo 全部为 T-PKG-001，归 M7-08）
- 首次全量运行有 1 例偶发（`getDisplayDurationMs` 真实时钟显示定时器在并发下超时）；单独运行通过，重跑全量通过 → 既有时序抖动，非本批次引入

## 已知限制 / 后续依赖
- **真实磁盘耗尽演练未做**：测试注入 mock `readStorage`，验证的是阈值决策与停服接线，不依赖真实磁盘空间；真实磁盘 2 GiB/256 MiB 行为需在真实 Windows 环境验证（M7-08 发布验收）。
- **预警阈值复用**：1 GiB 或卷 10% 预警沿用 `DiagnosticsSource` 既有实现；`StorageMonitor` 只承担 256 MiB 停服决策，未统一两者。若未来要扩展预警周期化，可在 StorageMonitor 侧再加低空间回调。
- **增长量基准**：每千条 ≈ 0.996 MiB 为「session + trace + 2 transition + 索引」的合成基准（无加密快照正文）。真实房间含快照（RAW/NORMALIZED/决策等）会更高；后续可用 M7-06 真实样本校准。

## 审查轮留档
（批次级验证 + 两轮 Subagent 审查后补充）
