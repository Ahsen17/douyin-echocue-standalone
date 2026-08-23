# TD-08：LLM 提示词无页面化调整（配置化 system prompt）

> 技术债务批次 `feat/TD-06-07-08` 第一个原子任务。`PromptAssembler` 的 system prompt 由硬编码改为可配置：默认用代码模板，用户提交新模板后保存并应用；user 部分保持代码组装。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（`progress/TECH-DEBT.md` TD-08） |
| 分支 | feat/TD-06-07-08 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-08-23 |
| 关联 | M5-05（PromptAssembler）、LLM 提示词设计文档 §3.2 |

## 改动

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` | 新增 `SystemPromptV1Schema`；`SettingsV1Schema.prompt?`、`ConfigViewV1Schema.prompt?`；`ConfigUpdateRequestV1Schema.systemPrompt?`（superRefine 放宽为 roomReference/provider/systemPrompt 至少其一） |
| `docs/06-data-interface/schema/contracts-v1.ts` | 镜像同步（与 contracts 包忽略空白 byte-identical） |
| `src/main/config/config-control-handlers.ts` | `get()` 返回 `prompt`；`update()` 处理 `systemPrompt`（非空保存 `custom-<uuidv7>` 版本 + updatedAt；空串清除） |
| `src/main/prompt/PromptAssembler.ts` | 抽出不可变 `SYSTEM_HARD_RULES_V1`（原 7 条硬性规则整段）；`renderPrompt` 经 `PromptInput.systemPromptTemplate/Version` 注入；自定义模板 `system = 模板 + 硬规则块`；默认字节不变 |
| `src/main/prompt/types.ts` / `index.ts` | `PromptInput` 加两个可选字段；新增 `SystemPromptConfig` 类型导出 |
| `src/main/suggestion/types.ts` | `SuggestionOrchestratorDeps.getSystemPrompt?` |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | `startSession` 冻结 `frozenSystemPrompt`（与会话内 safety/members 冻结一致）；`runAttempt` 注入 renderPrompt |
| `src/main/service/create-controller.ts` | 接线 `getSystemPrompt`（读 `settings.prompt`，缺省 null → 代码默认） |
| `src/renderer/main/nav.ts` | `NAV_ITEMS` 7→8，新增「提示词设置」 |
| `src/renderer/main/App.tsx` | pages map 挂 `PromptPage` |
| `src/renderer/main/pages/PromptPage.tsx`（新） | 配置页：读当前模板、textarea 编辑、保存/恢复默认、说明硬规则追加与会话生效 |
| `src/contracts/test/schemas.test.ts` | +8 用例（SystemPrompt/Settings 带 prompt/ConfigView 带 prompt/ConfigUpdate systemPrompt 合法与清除） |
| `tests/unit/prompt/prompt-assembler.test.ts` | +5 用例（自定义模板 + 硬规则追加 + 版本记录 + 空白视为默认 + user 不变） |
| `tests/unit/config/config-handlers.test.ts` | +2 用例（保存/清除） |
| `tests/integration/config/settings-store.test.ts` | +1 用例（prompt 往返 + undefined 清除落盘） |
| `tests/unit/renderer/nav.test.ts` | 断言改为 8 项 |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | +1 用例（frozen prompt 注入 RENDERED_PROMPT 快照） |
| 数据模型文档 §SettingsV1 | 补 `prompt` 字段 |
| LLM 提示词设计文档 §3.2 | 补「TD-08 用户可配置模板」说明 |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 165 passed / 0 failed
- `npm run test` ✅ 1061 passed / 5 skipped（既有 skip）

## 说明

- **硬约束不丢**：`SYSTEM_HARD_RULES_V1` 为不可变常量，任何自定义模板都会在组装时追加，JSON-only 输出与安全边界不可被配置移除。
- **默认行为不变**：未配置时 `renderPrompt` 返回字节不变的 `SYSTEM_MESSAGE_V1`；`getDefaults()` 不加 prompt 字段（缺省即代码默认，免迁移）。
- **审计可复现**：自定义模板保存时生成 `custom-<uuidv7>` 模板版本，`RENDERED_PROMPT` 快照记录实际 system 与版本。
- **生效时机**：编排器在 `startSession` 冻结该配置，不热切换（与 safety/members 一致），UI 提示「下次启动服务时生效」。
- **权限边界**：模板文本非敏感数据，走既有 `config.get/update` 主窗口通道；user 组装数据仍不过 IPC。
