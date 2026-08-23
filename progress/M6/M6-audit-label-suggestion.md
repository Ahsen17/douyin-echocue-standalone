# M6 补记：审计打标表单直接展示 AI 回复与提词

> 非路图插入任务：golden set 打标时，打标表单内直接展示该条的 AI 原始回复建议与提词，无需跳去「工作流上下文」翻找。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | feat/M6-audit-label-suggestion |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | UI §8.2（审计工作区/打标）；M6-10（打标与修订入口） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/main/audit/audit-logic.ts` | 新增 `extractSuggestionFromWorkflow` + `WorkflowSuggestion` 类型：遍历 transition 的 SUGGESTION_JSON snapshot，DIRECT_PAYLOAD 解析 snake_case `quick_reply`，LLM_PARSED_OUTPUT 解析 camelCase `quickReply`；畸形/缺失返回 null |
| `src/renderer/main/pages/AuditPage.tsx` | `DetailTabs` 将已加载的 `workflow` 传入 `LabelForm`；打标表单 radio 前渲染只读块「AI 建议回复 + 提词」 |
| `src/renderer/main/styles.css` | 新增 `.ai-suggestion` 卡片样式 |
| `tests/unit/renderer/audit-logic.test.ts` | 新增 `extractSuggestionFromWorkflow` 4 用例（direct/LLM/缺失/畸形） |

## 关键设计点

- 完全复用已加载的 `AuditWorkflowV1`，无新增 IPC、无契约变更。
- 提取逻辑镜像 `src/main/reflux/payload-builder.ts` 的 `extractSuggestion`，两种 source（golden 直出 / LLM 生成）都可读。
- 无建议（`hasSuggestion === false` 或 workflow 无 SUGGESTION_JSON）时不渲染该块。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1069 通过、5 跳过
- `npm run build`：通过
- 新增用例：audit-logic extractSuggestionFromWorkflow（direct snake_case / LLM camelCase / 缺失 / 畸形 JSON）

## 未关闭风险

- 无。打标仍以 `row.hasSuggestion` 为准；AI 建议块仅为展示辅助。
