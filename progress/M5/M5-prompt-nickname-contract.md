# M5 补记：提示词 user JSON 加入人设昵称、移除 id/version/contract

> 非路图插入契约调整：发给 AI 的 `user` 消息只保留语义内容，人设昵称以独立 `nickname` 字段加入；移除 `contract`、`persona_id`、`persona_version`、`team_boundaries.version` 等对模型无信息价值的字段。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入契约调整（非路图原子任务） |
| 分支 | feat/M5-prompt-nickname-contract |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | LLM §3.2/§3.3（user 消息结构、版本标记）；M5-05（PromptAssembler） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/prompt/types.ts` | `PersonaSnapshot` 增加 `nickname: string` |
| `src/main/persona/PersonaRouter.ts` | `PersonaRoute` 增加 `displayName`；`resolvePublishedSnapshot` 返回 `summary.displayName` |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | 构建 `personaSnapshot` 时带 `nickname: personaRoute.displayName` |
| `src/main/prompt/PromptAssembler.ts` | `buildUserPayload`：移除 `contract`；`persona` → `{ nickname, content }`；`team_boundaries` → `{ policy_text, keywords }`；`PROMPT_ASSEMBLER_VERSION_V1`→`v2`、`USER_CONTRACT_ID_V1`→`echocue.reply_generation.v2`（保留导出，仅内部标识，不再写入 user JSON） |
| `docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md` | user JSON 结构示例同步：去 contract/persona_id/persona_version/team_boundaries.version，persona 增加 nickname；版本标记说明 |
| 测试 | `prompt-assembler.test.ts`（PERSONA 增 nickname、persona/team_boundaries 断言、顶层 key 去 contract、不泄漏断言去 p-1/version/contract）、`suggestion-window.test.ts`（personaSnapshot 增 nickname）、suggestion 两个 orchestrator 测试的 route mock 补 displayName |

## 关键设计点

- `nickname` 是唯一需要发给模型的成员身份信息；`persona_id`/`persona_version`/`team_boundaries.version` 是内部标识，模型无法据此获取信息，只留在 `RENDERED_PROMPT` 审计快照（orchestrator 仍单独记录 personaId/version/contentHmac/禁忌版本）。
- `RENDERED_PROMPT` 快照的 personaId/version/contentHmac/禁忌版本字段不变，审计可复现性保留。
- `docs/06-data-interface/fixtures/output-validation-fixtures-v1.json` 的 `defaults.persona` 仅用于输出校验上下文（非 prompt），未改动。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1065 通过、5 跳过
- `npm run build`：通过
- 重点用例：prompt-assembler（19 用例，含新的 persona 结构与不泄漏断言）、suggestion-window（6 用例）

## 未关闭风险

- prompt 契约变更会影响已有 `RENDERED_PROMPT` 快照的 `user` 内容（不再含 contract/id/version），属于预期行为变更；旧快照仍可复现（版本标记已升 v2 区分）。
- 若甲方需要把 contract 标记重新放回 user 消息，可再评估（当前按用户确认移除）。
