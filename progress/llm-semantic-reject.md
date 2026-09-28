# LLM 单次调用集成语义判断（低价值/风险弹幕直接驳回）

> 修复真实缺口：BM25 语义初筛（`evaluateSemanticFilter`）覆盖面依赖 pre_set/golden_set 相似案例；检索无命中或命中全为积极语义时，措辞新颖的低价值/风险弹幕会以 CANDIDATE 身份直通 LLM 生成路径，仅靠 prompt 软规则兜底。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入任务（非路图原子任务，公共契约变更，单独成批） |
| 分支 | feat/llm-semantic-reject |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-09-28 |

## 方案

单次 LLM 调用同时完成语义判断与内容生成（不新增第二次模型往返，P95 ≤3s 约束不变）：模型先判 `semantic_type`（复用现有 `SemanticTypeV1` 7 值枚举），若为 `low_value`/`filter_risk` 则仅输出驳回结论（不生成回复），其余类型正常输出 `quick_reply` + `cues`。

代码侧强制确定性优先级，模型自我裁定不可信：

- `action:'reject'` 一律驳回（含积极类型的 fail-safe 驳回）
- `action:'generate'` 但 `semantic_type` 为 discard 类型（`low_value`/`filter_risk`）→ 覆写为驳回

## 改动

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` + 镜像 `docs/06-data-interface/schema/contracts-v1.ts` | `TraceReasonCodeV1Schema` 新增 `LLM_SEMANTIC_DISCARD`；新增 `SuggestionGenerateV2Schema`/`SuggestionRejectV2Schema`/`SuggestionDecisionV2Schema`（discriminated union，判别字段 `action`）；`SuggestionOutputV1Schema` 原样保留供历史快照复现 |
| `src/contracts/test/schemas.test.ts` | TraceReasonCode 全值清单同步；新增 V2 union 全真值表测试 |
| `docs/06-data-interface/migrations/005_llm_semantic_reason_codes.sql`（新） | 表重建模式（同 002/003/004），`reason_code` CHECK 追加 `LLM_SEMANTIC_DISCARD` |
| `src/main/index.ts` | migrations 数组注册迁移 005 |
| `electron-builder.yml` | `extraResources` 注册迁移 005 打包资源 |
| `src/main/provider/types.ts` | `ProviderGenerateOk.output` 类型改为 `SuggestionDecisionV2`（从契约包导入，不本地重声明） |
| `src/main/provider/parse.ts` | 门禁 schema 换为 `SuggestionDecisionV2Schema` |
| `docs/06-data-interface/fixtures/provider-contract-fixtures-v1.json` | `schemaVersion` 1→2；成功用例补 `action`/`semantic_type`；新增 reject 解析成功、reject 携带 `quick_reply` → `OUTPUT_INVALID` 两用例 |
| `src/main/validation/LlmDecisionResolver.ts`（新） | 纯函数 `resolveLlmDecision`：真值表裁定 reject/generate，覆写模型的不可信自我裁定 |
| `src/main/prompt/PromptAssembler.ts` | 版本升级 template v1→v2、assembler v2→v3、`USER_CONTRACT_ID` →`echocue.reply_generation.v3`；硬规则重写为双分支输出；系统消息补 7 类语义中文定义 |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | `GENERATED` 迁移后接 `resolveLlmDecision`；reject → `discard(attempt, 'LLM_SEMANTIC_DISCARD')` 不进 validator、不展示；generate → 现有校验流程不变 |
| `docs/06-data-interface/fixtures/audit-snapshot-fixtures-v1.json` | 保留 V1 minimal；新增 `LLM_PARSED_OUTPUT` 的 `v2_generate`/`v2_reject` 两个变体样例 |

状态机复用现有边 `LLM_PENDING→GENERATED→DISCARDED`，无新状态、无新边。审计页、reflux 回流层零代码改动（`extractSuggestion` 对 reject 快照天然返回 null）。

## 测试

- `tests/unit/validation/llm-decision-resolver.test.ts`（新）：真值表全行覆盖（reject 各语义类型、generate+discard 类型覆写、generate+积极类型正常通过）
- `tests/contract/T-AUD-001-snapshot-fixtures.test.ts`：新增 v2 generate/reject 快照变体断言，reject 变体显式断言无 `quickReply`/`cues`
- `tests/contract/T-PROV-001-provider-contract.test.ts`：fixture `schemaVersion` 断言同步 2；output 断言按 action 分支
- `tests/integration/T-AUD-001-audit-storage.test.ts`：新增 LLM 语义驳回快照 + migration 005 `LLM_SEMANTIC_DISCARD` 写入用例（证明迁移生效）
- `tests/integration/storage/migration-runner.test.ts`：全量迁移 `[1..5]` 用例
- `tests/integration/suggestion/suggestion-orchestrator.test.ts`：新增 reject trace 持久化 + 无泄漏断言
- `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts`：reject 路径（无 validate/无展示）、覆写优先级、fail-safe 驳回单测
- `tests/unit/prompt/prompt-assembler.test.ts`：版本常量与字节级期望串同步 v2/v3
- `tests/e2e/mock-stream-harness.ts` + `mock-stream.test.ts`：provider stub 换 V2 generate 形状
- `tests/unit/provider/{interface,parse,deepseek,openai-compatible}.test.ts`、`tests/integration/provider/{deepseek,openai-compatible}.test.ts`：V2 形状同步
- `tests/unit/reflux/payload-builder.test.ts`：新增"LLM 语义驳回快照返回 null，不臆造回复"单测

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 214 passed
- `npm run test` ✅ 1243 passed / 5 skipped（跳过项为既有 Windows-only 打包 e2e 测试）
- `npm run build` ✅（main/preload/renderer 全部构建成功）
- 契约镜像漂移检查：`src/contracts/src/schemas.ts` 与 `docs/06-data-interface/schema/contracts-v1.ts` 本任务改动内容逐段比对一致，无漂移（预存的单行注释位置偏移与本任务无关）
- 手动冒烟：**未执行**——需要运行中的 Electron 应用连接真实 Douyin WebSocket/Qdrant/LLM provider，当前开发环境不具备该条件。已有集成测试（`persists an LLM semantic reject trace and shows nothing`）以 mock 依赖覆盖等价行为路径。

## 已知行为（有意的边界语义）

- 旧 V1 形状的模型响应从此一律判 `OUTPUT_INVALID`（有意破坏，prompt v2 已告知模型新形状）
- LLM 语义驳回的具体语义类型记入 `LLM_PARSED_OUTPUT`/`FINAL_REASON` 快照的 `semanticType` 字段，reason code 层面不区分 `low_value`/`filter_risk`，统一 `LLM_SEMANTIC_DISCARD`
- 本任务不改动 metrics（`suggestionResult{result='discarded'}` 已天然覆盖新驳回路径）
