# M7 补记：修复 Qdrant 初始化与 pre_set 运行期导入缺口（gap fix）

> 本任务为非路图插入实现任务，依据 `progress/M7/M7-qdrant-init-preset-import-gap.md` 调查记录，落地 gap 文档「方向 A」并修复「Qdrant 侧车从不启动」根因。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入实现（缺陷修复 + 功能接线），非路图原子任务 |
| 分支 | feat/retrieval-preset-import |
| 状态 | ✅ 已完成（PR #36 合并、master CI 通过） |
| 完成时间 | 2026-08-23 |
| 追溯 | RUNBOOK §2.2/§3.1/§3.2/§5.1/§8.2；PRESET §1/§6/§7；A-05；T-RET-001；T-SCOPE-001 |

## 根因与修复

**根因**：M3-04/05 的 `importPreSet`/`bootstrapPreSet` 只被测试调用；生产代码 `createServiceController`/`index.ts` 只构造 QdrantSidecarManager、从不 `start()`；无 IPC/preload/UI 导入入口。门禁 `isRetrievalReady`（service-gate.ts）要求 `pre_set` alias 存在 → 安装后「启动服务」恒被 `E_QDRANT_UNAVAILABLE` 拒绝。

**修复（方向 A）**：

1. **Qdrant 侧车启动**：`createServiceController` 暴露 `qdrant`/`qdrantClient`；`index.ts` 装配成功后非致命启动侧车（失败不崩溃，门禁照常 fail-closed，`getStatus` 如实报不可用）；`doQuit()` 在 `controller.stop()` 之后 `await qdrant.stop()`，保证退出无孤儿进程。
2. **运行期导入入口**：新增 `retrieval.getStatus`（只读就绪状态）/`retrieval.importPreSet`（内容字符串）两条 IPC，复用 `importPreSet` 严格全包校验 + `bootstrapPreSet` 原子切换；并发导入串行化；服务运行中拒绝导入（主进程 + UI 双保险）。
3. **契约收口**：错误码唯一权威移到 contracts（`PreSetImportErrorCodeV1`），新增 `PreSetImportErrorV1`/`PreSetImportResultV1`/`PreSetImportRequestV1`/`RetrievalInitStatusV1`；错误列表截断 100 条并置 `truncated`（IPC 体积有界）。
4. **UI**：RunPage 新增「检索初始化」卡片（四态：loading/unavailable/needs-import/ready），`<input type="file">` + FileReader 读取 JSONL（保持 renderer 无 Node/fs 边界），导入结果只展示 profile 摘要与错误码（不含案例原文）。
5. **metadata 补全**：`createCollectionWithSparse` 将 `pre_set_sha256` 写入 collection metadata，使重启后 `getStatus` 仍能回读 profile 事实。

**未采用**：方向 B（空库降级启动，与 RUNBOOK §2.2 冲突）；方向 C（仅离线脚本，不满足用户自助）。

## 产出文件

- `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts`（同步逐字节）— 5 个新 schema + 类型别名
- `src/main/retrieval/retrieval-control-handlers.ts`（新）— getStatus/importPreSet 纯逻辑
- `src/main/retrieval/retrieval-control-ipc.ts`（新）— `wireRetrievalControl`
- `src/main/retrieval/pre-set-importer.ts` — errorCode 类型改从 contracts 导入（校验语义不变）
- `src/main/retrieval/bootstrap.ts` — collection metadata 补 `pre_set_sha256`
- `src/shared/ipc-channels.ts` — `retrieval.getStatus` / `retrieval.importPreSet`
- `src/main/service/create-controller.ts` — 暴露 `qdrant`/`qdrantClient`
- `src/main/index.ts` — wireRetrievalControl + 启动 qdrant + doQuit 停止 qdrant
- `src/preload/main-preload.ts` — `retrieval.{getStatus,importPreSet}`
- `src/renderer/main/run/retrieval-state.ts`（新）+ `components/RetrievalCard.tsx`（新）+ `pages/RunPage.tsx` + `styles.css`
- `docs/06-data-interface/fixtures/retrieval-init-import-fixtures-v1.json`（新）+ `tests/fixtures/loader.ts`
- 测试：`schemas.test.ts`(+7)、`tests/contract/T-RET-001-retrieval-init-import.test.ts`(新, 7)、`tests/unit/retrieval/retrieval-control-handlers.test.ts`(新, 11)、`tests/integration/retrieval/retrieval-init-handlers.test.ts`(新, 3)、`tests/unit/renderer/retrieval-state.test.ts`(新, 6)
- `tests/unit/ipc/preload-surface.test.ts` — allowlist 补 `retrieval` + 通道接线断言
- `tests/contract/T-SCOPE-001-scope-reverse.test.ts` — 允许合法检索初始化通道，仍禁止 golden/bad-case/sync/threshold 内部面

## 不变量保持

- `pre_set` 运行期只读：导入仅在停服态、走 bootstrap 新版本 collection + 原子 alias 切换；不提供运行期改写。
- 导入失败整体拒绝：复用 importer 全包语义 + bootstrap 失败清理临时 collection；旧 active 保留。
- `avg_doc_len_baseline` 冻结、profile 变更走版本迁移（bootstrap 即该路径）；二次导入换包 = 新 profile，旧 collection 保留回滚窗口。
- 门禁不放松：`isRetrievalReady` 逻辑不变，未导入仍拒绝启动；集成测试用真实 Qdrant 打通「导入→就绪→门禁放行」闭环。
- Renderer 无 Node/fs/dialog；导入内容单向 renderer→main，main 不回传 payload；错误报告仅 line/id/path/errorCode。
- 无枚举重复：错误码统一收口 contracts。

## 测试命令

```bash
npm run typecheck
npm run test:contracts
npm run test
npm run build
# 专项：npx vitest run tests/unit/retrieval/retrieval-control-handlers.test.ts \
#   tests/integration/retrieval/retrieval-init-handlers.test.ts \
#   tests/unit/renderer/retrieval-state.test.ts \
#   tests/contract/T-RET-001-retrieval-init-import.test.ts
```

全量结果：typecheck 零错误；contract 155/155；vitest 1035 passed / 5 skipped；build 通过。集成用例依赖 `assets/qdrant_linux`（仓库已有）。

## Subagent 审查（两轮，均非 fork 完全隔离）

**第一轮**：无 P0；P1×3 + P2×3 全部修复：
- P1-1 导入互斥 N≥3 不串行 → 改 promise-chain（`chain = task.catch(...)`），链尾永拒、失败不毒化后续。
- P1-2 导入/启动 TOCTOU → 队列等待后重查守卫 + `isServiceStopped = STOPPED && !controller.isStarting()`；`ServiceController` 新增 `isStarting()`（`phase !== 'idle'`）。
- P1-3 Qdrant 启停互斥/退出孤儿 → `start()` 先预留 `this.starting` 再跑 `doStart()`（防并发双起）；`stop()` 等待 pending start 后 `killChild()`；`doStart` 失败路径直接 `killChild()`（避免自等待死锁）。
- P2-4 ipc-allowlist 补 wireRetrievalControl + 2 通道（27→29）。P2-5 RetrievalCard 未就绪轮询刷新。P2-6 错误 id/path 截断至契约上界。
- 新增测试：三并发串行化、队列后守卫重查、错误截断、并发 start 幂等、stop 打断 pending start 无孤儿。

**第二轮**：无 P0/P1；P2-1（门禁意外抛出 phase 滞留 'gate' 会经 isStarting() 永久阻断导入）已修复——`start()` 包 `runGate()`，异常复位 `phase='idle'` 后重抛 + 单测。P2-2（killChild `once(exit)` 窄竞态，**既有代码原样搬移**）与 P2-3（主进程 bootstrap 失败时轮询持续，**已降级路径**）为非阻塞，接受并记录，不改动。

## 已知限制 / 后续

- **首次运行完整向导未实现**：本任务为 RunPage 内联导入卡片（保持七入口导航），非 RUNBOOK §3.1 描述的独立初始化向导；向导作为后续可选增强，不改变本任务「可导入、可启动」的核心能力。
- **`getStatus` 只读**：不触发 sidecar 启动重试；sidecar 启动失败由 `index.ts` 一次性尝试 + 导入时 `ensureQdrant()` 重试。
- **T-PKG smoke-quit 时序风险**：eager 启动 Qdrant 后，4s smoke-quit 可能早于 Qdrant 就绪；`start()` 中断被 `.catch` 吸收、`stop()` 等待 pending start 后清理，不阻塞退出码 0；最坏等待受 startup timeout（15s）约束。若 Windows CI 出现孤儿进程断言失败按 `fix/` 处理。
- **T-SCOPE-001 变更说明**：新增通道为合法用户面初始化能力（RUNBOOK §3.1 强制的导入流程），测试改为显式允许 `retrieval.getStatus`/`retrieval.importPreSet` 两个受控通道、其余 `retrieval.*` 仍禁止。

## 结论

PR #36 已合并到 master（merge commit `40ce6b8`），master CI 通过（Test on Windows ✅ 3m35s、Package on Windows ✅ 4m46s，后者真实执行安装→`--smoke-quit` 启动→退出无孤儿→升级→卸载）。缺口关闭：安装后 Qdrant 侧车随应用启动、运行页可导入 pre_set、导入后门禁 `isRetrievalReady` 放行。

## 追溯

- RUNBOOK §2.2/§3.1/§3.2/§5.1/§8.2、PRESET §1/§6/§7、A-05；契约新增 schema（同步 docs）；无 migration/settings schema 变更。
