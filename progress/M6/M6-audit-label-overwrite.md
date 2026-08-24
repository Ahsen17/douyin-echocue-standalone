# M6 补记：审计打标改为按原反馈 ID 覆盖（不再追加修订）

> 非路图插入任务：审查反馈「已保存为当前有效打标；再次编辑会产生新修订，不覆盖历史」不认可——再次打标应根据原 ID 覆盖当前打标，而非追加修订。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | fix/M6-audit-label-overwrite |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | DATA §4.3（打标、outbox 与幂等性）；UI §8.2（审计工作区/打标）；M6-10 |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/storage/AuditStoreWorker.ts` | `submitLabel`：同 trace 至多一条当前反馈。首次打标 INSERT；再次打标按原 `feedback_id` 在原行 UPDATE 覆盖（`revision_no` 仅作乐观锁版本号递增），覆盖时先删除该反馈遗留的 `PENDING/FAILED/RUNNING` outbox job，再按新打标回流意图写 `sync_status` 与 job。`traceRevisionCount` 改为返回最新 `revision_no`（版本基线） |
| `src/main/reflux/payload-builder.ts` | `computeCaseId` 去掉 `revision_no`，锚定稳定 `feedback_id` → 覆盖式重打标复用同一 golden point（Qdrant upsert 覆盖） |
| `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts`（镜像） | `revisionCount` / `expectedRevisionNo` 注释改为「当前打标版本/覆盖式重打标」 |
| `src/renderer/main/pages/AuditPage.tsx` | 文案改为「已保存为当前有效打标；再次编辑会按本条原记录覆盖，不保留旧打标」 |
| `src/renderer/main/audit/audit-logic.ts` | `defaultRevisionCount` 注释改为当前打标版本基线 |
| `docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md` | §3.2 回流小节改为覆盖式单反馈模型；`case_id = feedback:{feedback_id}` |
| `docs/09-design/Echocue-数据建模与迁移设计-v0.1.md` | §1 不变量表、§4.3 表/事务顺序、§5 图与回放要求改为覆盖语义 |
| `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md` | §8.2 打标文案、状态表改为「按原记录覆盖当前打标」 |
| `tests/integration/T-AUD-001-audit-storage.test.ts` | 「增量修订」用例改写为「覆盖」用例（同 feedback_id、revision_no=2、覆盖时清除陈旧 job）；新增「仍满足回流时在同一反馈上写新 job」用例 |
| `tests/unit/reflux/payload-builder.test.ts` | `computeCaseId` 单参；case_id/point id 稳定断言 |

## 关键设计点

- **覆盖语义**：同 trace 只保留一条当前反馈，历史修订不再保留；审计 workflow 的 transition/snapshot 证据链不受影响（打标本身成为单值）。
- **乐观锁**：`revision_no` 从「修订序号」变为「覆盖版本号」，`expectedRevisionNo` 仍是渲染端观察到的版本基线；并发编辑仍会被拒绝。
- **陈旧 job 清除**：覆盖时在同一事务删除该反馈 `PENDING/FAILED/RUNNING` 的 outbox job，防止被取代标签的 UPSERT/SET_BAD_CASE 按新标签误回流。worker `completeSyncJob` 对被删 RUNNING job 的兜底（changes=0 → 抛错 → 丢弃）保持不变。
- **golden point 稳定**：`case_id` 锚定 `feedback_id`（不再含 `revision_no`），重打标 upsert 同一 point，避免 golden_set 累积重复样本。
- **schema 不变**：无 DDL 变更，`001_initial_schema.sql`（checksum 固定）未改动；`UNIQUE(trace_id, revision_no)` 对单行模型仍成立。
- 路图 `docs/08-delivery` 中 M6-10 验收文案「修订而非覆盖」未改动（路图源文件不得修改），以本次用户指令为准。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1082 通过、5 跳过（覆盖语义新增用例全绿）
- `npm run build`：通过
- 新增用例：T-AUD-001 覆盖（同 feedback_id / rev=2 / 清陈旧 job）、覆盖仍回流（同 feedback_id / rev=2 / `:2:UPSERT`）；audit-sync-jobs 覆盖删除已 claim RUNNING job 的竞态路径；payload-builder case_id 稳定

## 两轮 Subagent 审查

- 第一轮（隔离只读）：无阻断项；1 项「重要」——覆盖删除已 claim RUNNING job 的竞态路径无测试覆盖。已补 `audit-sync-jobs` 用例并复跑全量验证。
- 第二轮（全新隔离只读）：无阻断项，**可创建 PR**；独立复跑全部验证通过，逐断言核验新增用例无假阳性。非阻断建议：乐观锁 UPDATE 可加 `AND revision_no = observed` + `changes===1` 作 CAS 防御性硬化（当前单线程同步架构不可达，低危），登记为后续加固项。

## 未关闭风险

- 极窄竞态：覆盖发生在 worker 已 claim（RUNNING）且 Qdrant upsert 已执行的瞬间，被取代 job 可能留下孤立 point；正常路径下覆盖已删除该 job，下一 sweep 的 job 若存在会以新内容覆盖。预发布 beta 阶段可接受。
- 旧数据兼容：升级前已按 `feedback:{feedback_id}:{revision_no}` 生成的 golden point 在首次覆盖后会与新格式 point 并存（旧 point 成孤立）。预发布阶段无真实业务数据，可接受；如需清理需 Qdrant 侧人工处理。
- 后续加固：`submitLabel` 覆盖分支 UPDATE 未附 `AND revision_no = observed`（当前单线程同步架构不可达；如需多实例并发再补 CAS 守卫）。
