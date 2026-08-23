# M7-05 模拟 E2E 实时流

## 状态
已完成（2026-08-23），批次分支 `feat/M7-04-05`，M7 集成验证批次第二个原子任务

## 目标与范围
完成判据（路图 M7-05）：**建设可重复的模拟 E2E 实时流，过滤、直出、LLM、过期、展示抑制、停服、审计故障均生成对照审计**（A-02～A-08、T-CON/T-RET/T-AUD/T-OVR）。

- **包含**：headless E2E harness（真实 WebSocketServer 模拟 douyinLive + 真实 AuditStoreWorker + 真实 ServiceController + 注入 mock 检索/Provider/展示 sink）；七场景 + 会话去重 + gift/like 边界 + T-PERF-001 合成时延采集；**修复 `SuggestionAttemptOrchestrator` session 去重真实缺陷**。
- **不包含**：真实 Electron 窗口/真实 sidecar 进程（现有 E2E 层即单元风格，真实 Qdrant 双库行为已由 `tests/integration/retrieval/*` 覆盖）；真实房间时延 POC（M7-06）；Windows 安装 E2E（M7-08）。

## 设计决策
1. **headless E2E**：不启动 Electron/真实 sidecar。价值在「编排 + 审计对照」，检索/Provider 用可控 mock，避免 Qdrant 二进制依赖与时延波动。复用 `T-CON-002`（真实 WS + ServiceController + Noop sidecar + 真实 audit）与 `suggestion-orchestrator.test.ts`（真实 audit + orchestrator + mock 检索/Provider）双模式。
2. **真实时钟驱动场景**：展示抑制用真实显示窗口（首条展示窗口内送第二条 → DISPLAY_WINDOW_ACTIVE）；过期用较小 `windowMaxAgeMs` + 可控 mock Provider 延迟（> freshness deadline → DEADLINE_EXCEEDED）；不用 `vi.useFakeTimers`。
3. **对照审计 = 审计链元组**：`transitionTuples(workflow)` 提取 `[fromState, toState, reasonCode]`，与预期 canonical 链比对；`waitForTerminal` 轮询终态（不用固定 sleep）。
4. **trace 定位**：`traceIds()` 按 `rowid` 顺序查询会话内 trace（audit_trace 为 TEXT PK，rowid 反映插入序），映射到发送顺序。

## 生产代码改动（真实缺陷修复）
`src/main/suggestion/SuggestionAttemptOrchestrator.ts` `handleComment` 的 session 去重分支：
- **问题**：原实现对重复 `source_message_id` 再写一条 trace（RECEIVED→NORMALIZED→DISCARDED(LOW_VALUE)），但 `audit_trace` 有 `UNIQUE(session_id, source_message_id)`（migration 001:81）。真实审计库下重复帧的 `createTrace` 触发 UNIQUE 约束冲突抛错 → 生产环境会中断 WS 消息处理。mock 审计库（单测）未强制 UNIQUE，掩盖了该缺陷；本批次 E2E（真实 audit）首次暴露。
- **修复**：去重分支改为**静默丢弃**（首个出现已完整审计，重复帧不产生第二条审计行）。与 `UNIQUE` 不变式一致；显示窗口内到达的**新消息**（不同 msgId）仍按 DISPLAY_WINDOW_ACTIVE 审计，不受影响。
- **测试更新**：单测去重用例改为断言「重复帧不新增 trace/transition」（首条用命中禁忌关键词的评论保证 activity=LISTENING，因 DISPLAYING 守卫在去重检查之前运行）；E2E 去重用例断言「重复帧无第二条 trace」。

## 测试
- **新增 `tests/e2e/mock-stream-harness.ts`**：`buildMockStreamHarness(options)` —— 真实 WS server + audit worker（临时目录 + migration 001）+ ServiceController + orchestrator（mock router/personas/safety/retriever/provider + 记录型 sink + 可控延迟 Provider）+ `waitForTerminal`/`transitionTuples` 审计链 helper + `traceIds`/`startService`/`sendComment`/`sendStatus`/`stop`/`close`。
- **新增 `tests/e2e/mock-stream.test.ts`（10 用例）**：
  - 过滤（A-03）：禁忌关键词 → `RECEIVED→NORMALIZED→FILTERED(INPUT_SAFETY_FILTERED)`，无展示、Provider 0 次；
  - 直出（A-05）：golden 高置信 → 零 Provider、链到 HIDDEN；
  - LLM（A-06）：pre_set top1 → 恰一次 Provider、链到 HIDDEN；
  - 过期（A-06）：Provider 延迟 > deadline → `…→LLM_PENDING→DISCARDED(DEADLINE_EXCEEDED)`，无展示；
  - 展示抑制（A-06）：窗口内新消息 → `RECEIVED→NORMALIZED→DISCARDED(DISPLAY_WINDOW_ACTIVE)`；首条到期 HIDDEN；
  - 停服（A-02/A-07）：LLM_PENDING 中途 stop → 在途 trace `USER_STOPPED` 关闭、lifecycle STOPPED、sidecar/WS 清理；
  - 审计故障（A-07）：运行中关库 → `AUDIT_UNAVAILABLE` 停服；
  - 会话去重（boundary）：重复 `source_message_id` 无第二条 trace；
  - gift/like 不进入生成（T-CON）；
  - T-PERF-001：OVERLAY_RESULT 采集 e2eMs，断言 >0 且合成 P95 < 1000ms（宽松上限，真实 SLO 归 M7-06）。
- **修改 `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts`**：去重用例改为断言「重复帧不新增 trace/transition」。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：977 passed / 10 todo / 0 failed（较上任务净增 10 真实 E2E 用例；剩余 10 todo 全部为 T-STO-001(5, M7-07) 与 T-PKG-001(5, M7-08)，2 个 skip 为这两个 todo-only 文件）

## 已知限制 / 后续依赖
- E2E 依赖真实时钟与真实显示定时器，慢 CI 上展示/过期场景存在理论抖动；已用轮询终态 + 宽松超时 + 可控 Provider 延迟缓解。若持续不稳定，可改为注入时钟（本批次刻意避免与真实 WS 异步混用假时钟）。
- **去重缺陷修复的涟漪**：该修复使「同一 session 内重复帧不再产生审计行」成为既定行为。若未来需求要求记录重复帧到达，需调整 `audit_trace` 约束与审计模型（超出 MVP 范围）。
- `bootstrapPreSet` 仍未接线生产运行时（既有缺口，非本批次引入）：golden 直出依赖 bootstrap 落地；本批次 E2E 用 mock 检索覆盖编排链路，真实 Qdrant 双库行为仍由 retrieval/reflux 集成测试覆盖。
- 生产接线的端到端回流（打标 → outbox → Qdrant）需在 retrieval bootstrap 接线后联动验证。

## 批次审查
本任务（M7-04 + M7-05 同批次）的批次级验证、Subagent 严格审查、PR/CI/合并与进度收尾见批次收尾文档。
