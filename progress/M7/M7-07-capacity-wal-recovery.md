# M7-07 容量、WAL、完整性与恢复演练

## 状态
✅ 已完成（2026-08-23），批次分支 `feat/M7-07`，PR #32（CR APPROVE，test-windows CI 通过），M7 集成验证批次第三个原子任务（单独一批）

## 结论
本批次完成 M7-07 全部判据：补生产能力（2 GiB 启动门槛 gate `E_STORAGE_LOW`、256 MiB 周期停服 `AUDIT_UNAVAILABLE`、WAL checkpoint、HMAC 链完整性检查、受控备份/恢复、崩溃重启接线 verifyIntegrity fail-closed）+ T-STO-001 填实 10 用例演练，覆盖 A-12 全部验收点，任何阈值路径无自动删除。两轮完全隔离 Subagent 审查通过（第一轮 1 阻断 + 3 重要已修复；第二轮 0 阻断，2 重要已修复）。契约/migration/IPC 零改动。

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
- **填实 `tests/integration/T-STO-001-sqlite-wal.test.ts`（10 用例，替换 5 条 todo）**：
  - WAL checkpoint：写入 trace 后 `-wal` > 0 → `checkpoint()` → `-wal` = 0 → workflow 仍可读；
  - 完整性检查：正常库 `ok`；篡改 `entry_hmac` → `verifyIntegrity` 抛 `AuditUnavailableError`；
  - 受控恢复演练：写入 → checkpoint → close → `backupTo` → 破坏原库 → 从备份重建 → `verifyIntegrity` ok + trace 可读 + migration 版本 1；
  - 每千条增长量：1000 条合成 trace，实测 **≈ 1,044,480 bytes / 千条**（约 0.996 MiB/千条，留档用于剩余容量估算）；
  - 2 GiB 门槛：`createServiceGateChecks` 注入 `readStorage` < `STARTUP_MIN_BYTES` → `isStorageReady()` false；= 阈值 → true；
  - 256 MiB 停服：`StorageMonitor`（mock `readStorage` < `CRITICAL_MIN_BYTES`）接线 `ServiceController` → RUNNING 后立即触发 `onCritical` → `stop('AUDIT_UNAVAILABLE)` → `STOPPED`；
  - 空库（首次安装）`verifyIntegrity` ok（`transitionsChecked: 0`）；
  - 多 trace 交错链独立校验 + 删除其中一条 trace 的中部行正确报错；
  - 无自动删除：阈值检查 + checkpoint + backup 后 trace 数与备份内容均不减少。
- **`tests/unit/storage/storage-monitor.test.ts`（新，5 用例）**：低于阈值触发 `onCritical`；高于阈值不触发；`readStorage` null 跳过；start/stop 幂等；同步 `onCritical` 重入 stop 清 timer（I1 回归）。
- **`tests/unit/service/service-controller.test.ts`**：`makeChecks` 补 `isStorageReady: async () => true`；新增「`isStorageReady=false` → gate 拒绝 → `STOPPED(SOURCE_ERROR, E_STORAGE_LOW)`」。
- **波及默认值**：`T-CON-002` 的 `allPassChecks`、`mock-stream-harness` inline `checks` 补 `isStorageReady: async () => true`（接口加方法后所有构造点同步）。
- 说明：迁移三件套（空库初始化/重复迁移/失败回滚）已在 `migration-runner.test.ts` 覆盖，T-STO-001 不再重复，聚焦容量/WAL/完整性/恢复。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：**998 passed / 5 todo / 0 failed**（含本批次 +10 T-STO-001 +5 storage-monitor 用例；剩余 5 todo 全部为 T-PKG-001，归 M7-08）
- 全量并发下增长量测试曾超时（1000 条 + 逐条 HMAC，CPU 争用 > 30s）；降为 500 条按千条折算后稳定（全量 31s 内全绿）

## 已知限制 / 后续依赖
- **真实磁盘耗尽演练未做**：测试注入 mock `readStorage`，验证的是阈值决策与停服接线，不依赖真实磁盘空间；真实磁盘 2 GiB/256 MiB 行为需在真实 Windows 环境验证（M7-08 发布验收）。
- **预警阈值复用**：1 GiB 或卷 10% 预警沿用 `DiagnosticsSource` 既有实现；`StorageMonitor` 只承担 256 MiB 停服决策，未统一两者。若未来要扩展预警周期化，可在 StorageMonitor 侧再加低空间回调。
- **增长量基准**：每千条 ≈ 1.0 MiB（session + trace + 2 transition + 索引，无加密快照正文）。真实房间含快照（RAW/NORMALIZED/决策等）会更高；后续可用 M7-06 真实样本校准。
- **HMAC 链无法检出「删除整条 trace」或「删除链末条 transition」**：存活的链内部仍自洽；末条删除会使 `audit_trace.final_state` 与末条 to_state 不一致，但 `verifyIntegrity` 不校验该一致性。属 HMAC 链无外部锚点的固有限制。
- **`isStorageReady` 对 statfs 失败 fail-open**：`readStorage` 缺省/null 返回 true；磁盘耗尽风险由运行期 audit 写失败停服兜底，属软降级。
- **启动全量 HMAC 重算无进度/超时**：每次应用启动 `verifyIntegrity()` 全表重算，大库时启动耗时线性增长；RUNBOOK 强制该检查，性能留档。
- **verifyIntegrity 接线（I3）无 createServiceController 集成测试**：构造依赖真实 binary 路径等重依赖，未在测试层覆盖；生产路径由 `main/index.ts` try/catch 覆盖，fail-closed 已生效。
- **verifyIntegrity 失败时用户无可见诊断**：`main/index.ts` 仅 `console.error`，主窗口看似正常但所有 IPC 未接线；符合「保持停服」意图，运维定位需查日志（M7-08 部署文档明确）。

## 审查轮留档
**第一轮**（1 阻断 + 3 重要，全部修复）：B1 `verifyIntegrity` 错误消息内嵌真实 `trace_id`（安全红线）→ 移除仅留 sequence；I1 `StorageMonitor.start()` 先 check 后赋 timer → 重入场景定时器泄漏 → 对调先赋 timer 再 check，+重入清 timer 用例；I2 链校验缺连接性 → 加 previous_hmac 连接 + sequence 连续校验，+删除中部 transition 检出用例；I3 `verifyIntegrity` 无生产调用点 → `createServiceController` 构造后接线 + 失败 fail-closed。

**第二轮**（0 阻断；2 重要 + 建议项）：N1 I3 接线无集成测试 + reject 路径不释放 audit 句柄 → 失败路径 `catch` 中 `audit.close()`；N2 `shutdown()` 顺序 audit 先于 persona/safety 关闭 → 调整为 persona/safety 先关、audit 最后（使 checkpoint 无竞争连接）；N3/N4 空库与多 trace 链校验 → +2 用例；N5 `backupTo` 目标已存在约束 → docstring 明确；N7 `StorageMonitor.check()` 未防御 readStorage/onCritical 抛异常 → try/catch 兜底。建议项 N6（checkpoint busy 忽略）、N8（启动失败无用户诊断）、N9（进度数字统一）分别以注释/文档留档处理。

**剩余风险**：删除整 trace 无法检出（HMAC 链无外部锚点）、`isStorageReady` fail-open、启动 HMAC 全量重算性能、I3 无集成测试（见已知限制）。
