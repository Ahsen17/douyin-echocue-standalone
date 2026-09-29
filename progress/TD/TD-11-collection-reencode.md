# TD-11：检索集合停用词版本重建迁移（数据保全）

> 技术债务批次 `feat/TD-10-11-12` 第二个原子任务（gap 插入任务，非路图原子任务）。TD-10 bump tokenizer_version 后，已有 pre_set/golden_set 数据需要迁移路径：重新导入 pre_set 时自动 scroll 旧 golden payload 重编码，双别名原子切换。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（TD-11） |
| 分支 | feat/TD-10-11-12 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-09-29 |
| 关联 | TD-10（前置）、WP-8（golden 保全语义）、M7-02/03（golden 回流） |

## 改动

| 文件 | 说明 |
|------|------|
| src/main/retrieval/collection-reencode.ts | 新增：`readGoldenEntries`（scroll 全量 payload，分页）、`reencodeGoldenEntries`（以新 profile/管道重算向量，point id 与 payload 原样保留，仅重写 `tokenizer_version` 字段并严格校验） |
| src/main/retrieval/bootstrap.ts | `bootstrapPreSet()` 版本分支：golden metadata 版本不匹配 → 迁移模式（scroll→重编码→计数校验→smoke query→**双别名一次原子切换**→best-effort 删除旧集合）；兼容版本时保持 WP-8 语义完全不动 golden |
| src/main/retrieval/index.ts | 导出新模块 |
| docs/09-design/Echocue-数据建模与迁移设计-v0.1.md | 补「重编码以 Qdrant payload 为源真相（非 SQLite 重放）」实现说明 |
| tests/integration/retrieval/collection-reencode.test.ts | 新增 4 项集成测试（真实 Qdrant sidecar） |
| tests/unit/retrieval/bootstrap-pre-set-guard.test.ts | fake client 补 collection metadata（版本兼容场景），WP-8 原有断言不变 |

## 关键设计决策与实证

1. **golden 源真相是 Qdrant payload 而非 SQLite**：SQLite 审计受 30 天保留期清理，重放会丢超期点；scroll payload 重编码保全全部点（point id/case_id 不变，审计 `source_point_id` 引用继续有效）。
2. **Qdrant 拒绝无向量点**（集成实证：upsert 缺 `vector` 字段返回 400 `missing field vector`）——文本在新分词下零 token 的点（纯停用词）只能跳过并计数（`skippedEmptyVector`），它们本就无检索价值。
3. **校验失败即拒绝迁移**：任一 golden payload 严格校验不过（`skippedInvalidPayload > 0`）→ 抛错、别名未动、旧集合保留、新集合回滚删除，数据无损。
4. **双别名一次 `updateCollectionAliases` 原子切换**；旧集合删除在切换成功后 best-effort 执行（失败仅遗留孤儿集合，不回滚已完成的迁移）。
5. 重编码向量用**新 profile**（k1/b/avg_doc_len_baseline）计算，保证与同批新 pre_set 分数可比。

## 升级流程（用户已确认手动重导入方案）

1. 装新版启动 → pre_set metadata `tokenizer_version=v1≠v2` → 运行页提示 `E_TOKENIZER_MISMATCH`，`search()` 返回空 → 弹幕走 LLM-first。
2. 用户在检索页重新导入 pre_set → 触发迁移：新 pre_set + scroll 旧 golden 重编码 + 校验 + 原子双切换 + 删旧集合。
3. 未迁移的 PENDING `qdrant_sync_job` 无需改动：`GoldenSyncWorker.processOne` 每次从当前 golden collection metadata 读 profile，新集合 metadata 已携带新 profile。

## 验证

- `npm run typecheck`：0 错误。
- `npm run test:contracts`：214 通过（随 TD-10 已跑，本任务无契约改动）。
- `npm run test`：1262 通过。新增集成测试：
  - normal：v1 golden（含 `is_bad_case` 点）→ 迁移后双别名指向新集合、点数/payload 保全、metadata v2、旧集合删除；
  - boundary：纯停用词文本点被跳过（新集合点数 = 旧点数 - 1）；
  - failure：无效 payload → 拒绝迁移、别名未动、旧集合完整、无新集合遗留；
  - 兼容版本：re-import 不触碰现有 golden（WP-8 回归）。
- 无敏感内容：全部合成样本。

## 已知风险

- 迁移期间（导入执行中）服务必须处于停止态（既有 import 前置条件保证）。
- 纯停用词 golden 点会被丢弃（无检索价值）；如需保留 payload 事实，可从审计页面重新打标。
