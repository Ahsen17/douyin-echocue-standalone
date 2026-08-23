# M6 补记：人设昵称随草稿/发布保存、发布无需先存草稿

> 非路图插入任务：移除独立的「保存别名」按钮，昵称随「保存草稿」一并保存；「发布此版本」可直接发布当前编辑器内容，无需先手动保存草稿（保存草稿只是方便下次编辑）。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | feat/M6-persona-save-publish |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | M2-01/02（成员/别名/草稿/发布）；M6-04（团队与人设页） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/main/pages/PersonaPage.tsx` | `saveDraft` 先 `updateAliases` 再 `saveDraft(content)`；`publish` 改为「先存别名 → 以当前 draftText 创建草稿 → 发布该草稿」，发布内容=编辑器内容；移除 `saveAliases` 处理器与独立「保存别名」按钮；发布按钮不再依赖 `latestDraft` 存在，正文为空时禁用 |

## 关键设计点

- **昵称随草稿/发布保存**：别名输入框仍保留，但保存动作统一走「保存草稿」与「发布此版本」，消除「必须分开点保存别名」的割裂感。
- **发布无需先存草稿**：发布时以当前编辑器内容创建草稿再发布，保证发布版本与所见一致；先保存的草稿仅作下次编辑便利。
- 复用现有 `persona.updateAliases` / `persona.saveDraft` / `persona.publish` IPC，无契约变更、无 main 改动。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1065 通过、5 跳过
- `npm run build`：通过
- 既有 persona-handlers / persona-logic 测试不受影响（均为 handler 与纯逻辑层）

## 未关闭风险

- 发布会额外产生一个 DRAFT 行（由 `createDraft` 语义决定，随后立即 PUBLISHED），不会残留未发布草稿；多次直接发布会各留一个已发布版本（正常版本历史）。
