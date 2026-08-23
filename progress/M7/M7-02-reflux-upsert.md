# M7-02 golden UPSERT worker

## 状态
已完成（2026-08-23），批次分支 `feat/M7-01-02-03`，M7 回流批次第二个原子任务

## 目标与范围
完成判据（路图 M7-02）：**修正或评分≥85 的反馈进入 golden_set；绑定实际 persona/version；单点增量写入、禁止重建 collection**（W7、T-RET-001）。

- **包含**：`payload-builder.ts` 全量纯函数（deriveRefluxAction 已在 M7-01 建立，本次补 buildGoldenSetPayload/buildUpsertPoint/readGoldenProfile/extract*）；`GoldenSyncWorker`（processPending、退避重放、sweep 定时器、re-entrancy guard、UPSERT 分支）；`types.ts`/`index.ts`；接线（create-controller、main/index.ts、audit.onLabelSubmitted）；`bm25-weights` 签名放宽为 `GoldenProfileParams`；单测 + 真实 Qdrant 集成测试；进度文档。
- **不包含**：SET_BAD_CASE 执行（M7-03，本次在 worker 中占位为永久失败）；契约 schema 变更（零改动）；Qdrant sidecar 按需拉起（批次确认不做）。

## 设计决策（落实计划）
- **纯函数构建 payload**：`buildGoldenSetPayload(ctx, now)` 输入解密后的 FeedbackSyncContext + workflow，输出 `GoldenSetPayloadV1`（`GoldenSetPayloadV1Schema.parse` 兜底）；ACCEPTED 缺建议快照/CORRECTED 缺 correction/cues<2 → `RefluxPayloadError`（永久失败，不自动重试）。
- **建议来源**：CORRECTED 用 correction；ACCEPTED 用 `DIRECT_PAYLOAD.quick_reply`（snake_case）或 `LLM_PARSED_OUTPUT.quickReply`（camelCase）。
- **语义类型**：`RERANK_DECISION.mergedTopK[0].payload.semantic_type`（与 semantic-filter 结论一致），缺失兜底 `low_value`。
- **case_id / point_id**：`case_id = feedback:{feedback_id}:{revision_no}`；`point_id = uuidv5('echocue:golden_set:'+case_id)` 确定性，重试不产生重复 point。
- **profile 来源**：`readGoldenProfile` 从 `client.getCollection('golden_set')` 的 `config.metadata` 读 `bm25_k1/bm25_b/avg_doc_len_baseline`（bootstrap 写入），不新增持久化；向量用 `buildDocumentVector`（签名放宽为 `GoldenProfileParams`，后向兼容）。
- **worker 语义**：Qdrant 不可达（读 profile 失败）→ PENDING 保持不烧 attempts；真实 upsert 失败 → FAILED + attempts+1 + 指数退避（base 5s、cap 5min、maxAttempts 8）；`processPending` re-entrancy guard；`start()` 恢复崩溃残留 RUNNING。
- **接线**：`create-controller` 构造 worker、`shutdown()` 停止；`main/index.ts` 启动 + `wireAuditControl.onLabelSubmitted` → `goldenSync.processPending()`（提交后即时，fire-and-forget）。

## 测试
- `tests/unit/reflux/payload-builder.test.ts`（19 例）：deriveRefluxAction 各分支；computeCaseId/computeTargetPointId 确定性；buildGoldenSetPayload（CORRECTED correction / ACCEPTED 直出 snake_case / LLM camelCase / 截断 text-200·reply-80·cues-40 且裁剪 2-3 / semantic 兜底 / persona/score 透传 / 过 schema）；缺建议快照、缺 correction、cues<2 → RefluxPayloadError；extract* 助手；readGoldenProfile 合法/非法。
- `tests/unit/reflux/golden-sync-worker.test.ts`（8 例，mock QdrantClient）：Qdrant 不可达不 claim 不烧 attempts；退避未到不 rearm、到时命中；maxAttempts 用尽不再 rearm；UPSERT 端到端 complete 带 point.id；upsert 失败 FAILED（非永久）并停批；缺 context 永久失败；re-entrancy；start/stop 定时器。
- `tests/integration/reflux/golden-sync-worker.test.ts`（4 例，真实 Qdrant sidecar，binary 缺失 skip）：ACCEPTED 90 端到端回流（payload 正确、feedback SYNCED、job SUCCEEDED）；SuggestionRetriever 按 persona 过滤可检索；幂等（二次 sweep claimed=0、point 唯一）；Qdrant 不可达（端口 1）PENDING 不烧 attempts。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：940 passed / 15 todo（首次全量运行出现 1 例既有计时敏感测试偶发超时——`suggestion-attempt-orchestrator` 的 `reads the display duration from getDisplayDurationMs`（真实 30ms 定时器 + waitFor 500ms），在新增 4 个 Qdrant 集成测试加重并行负载时偶发；重跑全量通过，非本任务回归）

## 已知限制 / 后续依赖
- SET_BAD_CASE 执行在 M7-03（当前 worker 对 SET_BAD_CASE 抛 RefluxPayloadError 永久失败占位，M7-03 替换为真实实现）。
- 本批次确认不做 Qdrant sidecar 按需拉起：会话后打标回流需等服务下次启动 Qdrant 才执行，由 sweep 定时器持续重试（Qdrant 不可达 PENDING 不烧 attempts）。
- trace_id/persona_version 受 `GoldenSetPayloadV1Schema` uuidV7 约束：生产（uuidv7）无影响；测试必须用 uuidv7。
