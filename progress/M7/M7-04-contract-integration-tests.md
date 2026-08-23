# M7-04 全量 Contract/Integration tests

## 状态
已完成（2026-08-23），批次分支 `feat/M7-04-05`，M7 集成验证批次第一个原子任务

## 目标与范围
完成判据（路图 M7-04）：**按 DELIVERY §4.1/§4.2/§4.4 补齐各模块 Contract/Integration 层真实覆盖**（全部 `T-*` 追溯）。

- **包含**：从零建立缺失的 `T-SCOPE-001`（范围反向测试）；处理 `T-AUD-001` 遗留 `it.todo`（删除被取代骨架 + 补授权读者解密真实用例）；补 `T-SAFE-001` 输出复验用例；补 `T-DIAG-001` OTel 单测；补 `T-CON-002` 未开播门禁超时 + `ROOM_ENDED` 路径；补 `T-OVR-001` 托盘/退出流单测；修正 `safety-policy-fixtures-v1.json` OUTPUT 案例文本（使其真正命中 PII 检测）。
- **不包含**：`T-STO-001` 容量/WAL（M7-07 范围）；`T-PKG-001` Windows 安装（M7-08 范围）；`T-PERF-001` 时延采集（M7-05 合成采集，真实 POC 在 M7-06）；契约 schema/migration/IPC 变更（零改动，仅修正既有 fixture 文本）。

## 覆盖率盘点结论（本任务前置调研）
由覆盖率盘点 agent 输出并已核实：
- Contract 层 12 个 `tests/contract/*` 全部有真实断言、无 todo/skip。
- `T-SCOPE-001` 整个 `tests/` 无任何文件引用 → 最大缺口。
- `T-AUD-001` 4 条 headline todo（写读/哈希链/非法转移/写失败停服）行为已由 `storage/audit-store-worker.test.ts`(:81/:105/:177) + `T-CON-002`(:199) 覆盖 → 被取代的骨架。
- `T-AUD-001` :579「授权读者解密」为真实缺口（现有测试直接读 DEK，未测授权 API 路径）。
- `T-SAFE-001` OUTPUT 案例从未被驱动；`SuggestionOutputValidator.checkOutputSafety`（step 5）生产路径已存在，仅缺测试。
- `T-DIAG-001` `tests/` 零 OTel 引用；`OtelSetup.initOtel/shutdownOtel` 已实现。
- `T-CON-002` 缺「未开播门禁超时」与 `LIVE_ENDED` 路径。
- `T-OVR-001` 缺「关闭到托盘 + 显式退出」测试。
- 6 处 `describe.skip` 为 Qdrant/douyinLive 二进制条件守卫（`assets/` 已 git 跟踪，CI 会执行）→ 非缺口不改；`it.skipIf` douyin-sidecar:67 为 Windows `SO_REUSEADDR` 差异 → 保持。

## 测试改动（零生产代码改动）
### 新增 `tests/contract/T-SCOPE-001-scope-reverse.test.ts`（6 用例）
范围反向测试，断言公共表面（IPC 通道、契约 schema、adapter 公开 API）无越界能力：
- `IpcChannel` 无发弹幕/多房间/MCN/云端审计导出同步/检索内部机制通道；
- `DouyinLiveWsAdapter` 纯消费（connect/close/onEvent 存在，无 `send/write/post/publish/push/reply` 方法）；
- `LiveSourceEventSchema` 仅 ONLINE/OFFLINE/ENDED/COMMENT/SOURCE_ERROR 五种，无外发类型；
- `ConfigViewV1Schema`（用户可见）不含 `internalRetrieval`，而 `SettingsV1Schema`（主进程持久化）含 → 检索内部机制不越 IPC（CONTRACT §7/UI §7.1 边界）；
- 配置单直播间（`roomReference` 单值，无 rooms/streams/mcn/cloud/endpoint）；
- 审计 IPC schema（search/getWorkflow）无 golden/badCase/sync/threshold/score/envelope 字段。

### 修改 `tests/integration/T-AUD-001-audit-storage.test.ts`
- 删除被取代的 4 条 headline todo 骨架（行为已由同文件真实测试 + `audit-store-worker.test.ts` + `T-CON-002` 覆盖，映射见上）。
- 补「authorized reader 解密」真实用例：NORMALIZED_COMMENT 快照落库后 raw `audit_snapshot.envelope` ≠ 明文；`getTraceWorkflowV1`（audit.getWorkflow IPC 授权路径）解密返回原文；`AuditWorkflowV1Schema.parse` 通过；workflow 投影不含 envelope 字节（安全红线：只断言解密成功，不输出敏感原文）。「越权拒绝」由 IPC 权限层承担（preload-surface / ipc-allowlist 测试已覆盖浮窗无审计访问、错误 sender 拒绝），worker 层无授权概念，本用例验证的是授权解密路径。

### 修改 `tests/contract/T-SAFE-001-safety-fixtures.test.ts`（+3 用例）
驱动 OUTPUT 阶段 fixture 过 `SuggestionOutputValidator.validate`（step 5 输出复验）：
- `unsafe-output-discarded` → REJECTED + `PERSONAL_INFO_HIT`；
- 良性输出不误杀（ok:true）；
- `compiledRules=null` fail-closed → `RISK_RULE_HIT`。

**Fixture 修正**：`safety-policy-fixtures-v1.json` OUTPUT 案例文本由「个人地址」改为「家庭住址」——「个人地址」不在内置 PII 词表（住址/家庭地址/家庭住址/手机号…），原文本永不触发 PII 检测，属潜伏 fixture 缺陷（该案例从未被驱动故未暴露）。修正后该案例真正验证输出复验路径。

### 新增 `tests/unit/telemetry/otel-setup.test.ts`（5 用例，T-DIAG-001）
mock `@opentelemetry/sdk-node`/exporter 后测 `initOtel`/`shutdownOtel`：
- 无 endpoint 不建 metric reader/exporter；有 endpoint 建 OTLP reader 并传 URL；
- 重复调用幂等（仅一个 NodeSDK）；`shutdownOtel` 重置后 `initOtel` 可重启；
- 敏感字段（apiKey/traceId/rawComment）绝不进入 SDK/exporter 配置（A-13 反向）。

### 修改 `tests/integration/T-CON-002-ws-lifecycle.test.ts`（+2 用例）
- 「未开播门禁超时」：不发任何 status frame，短 `gateTimeoutMs` → `STOPPED(SOURCE_ERROR, E_SOURCE_UNAVAILABLE)`，不进入 RUNNING；
- 「`ROOM_ENDED` 路径」：RUNNING 后收 ROOM_ENDED → `STOPPED(ROOM_ENDED)`、sidecar 停止。

### 新增 `tests/unit/windows/tray-exit.test.ts`（5 用例，T-OVR-001/A-08）
- 主窗口 close：非显式退出时 preventDefault + hide（隐藏至托盘不退出）；显式退出时放行；
- 托盘菜单：显示主窗口触发 onShow；「退出 Echocue」确认后 onQuit、取消不 onQuit。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：967 passed / 10 todo / 0 failed（较上批次 945/15 净增 22 真实断言；剩余 10 todo 全部为 T-STO-001(5, M7-07) 与 T-PKG-001(5, M7-08)，2 个 skip 为这两个 todo-only 文件）

## 已知限制 / 后续依赖
- 未纳入本任务的 T-* 缺口及其归属：`T-STO-001` WAL checkpoint + 2GiB 容量 → M7-07；`T-PKG-001` Windows 安装 E2E → M7-08；`T-PERF-001` 真实房间时延 POC → M7-06（合成时延采集归入 M7-05）；`T-QUAL-001` 甲方人工验收。
- fixture 文本修正（safety-policy-fixtures-v1.json）属机器可读 fixture 与预期不一致时的修正（项目原则：冲突时修正 fixture 而非选择解释）。
- 后续 M7-05 复用本任务建立的审计链断言范式（对照审计元组提取 + 终态轮询）。

## 批次审查
本任务审查随批次级验证后统一执行（M7-04 + M7-05 同一批次，见 M7-05 进度文档）。
