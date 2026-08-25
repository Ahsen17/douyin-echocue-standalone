# 弹幕表情/空格规范化 + 浮窗显示原弹幕

> 修复用户实测缺陷：`[点赞]` 表情计入正文、空格污染检索/提示词；浮窗应显示原弹幕；纯表情弹幕不应进入生成管线。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入缺陷修复（非路图原子任务） |
| 分支 | fix/dataloc-migration-comment-normalize |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-25 |

## 用户确认口径

- 内层处理（`normalizedText`，供路由/检索/提示词/安全过滤）剔除表情 + 剔除所有空格/空行（仅保留 `@用户名` 后一空格）；
- 审计保留原始弹幕（`rawText` 不变）；
- 浮窗正文显示原弹幕（`rawText`）；
- 纯表情/纯空白弹幕（剔除后正文为空）→ 审计 `DISCARDED`，不进管线；
- 正则范围：所有 `[方括号]` 占位符。

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/safety/Normalizer.ts` | 新增 `EMOJI_PLACEHOLDER_RE`（`\[[^\[\]]+\]`）剔除表情；`COMPACT_WS_RE`（`(@\S+)\s\|\s+`）剔除除 `@用户名` 后一空格外的所有空白/空行 |
| `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts`（镜像） | `TraceReasonCodeV1` 新增 `EMPTY_NORMALIZED` |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | dedup 后、DISPLAYING 守卫前：`normalizedText` 为空 → 审计 `RECEIVED→NORMALIZED→DISCARDED('EMPTY_NORMALIZED')`；浮窗展示 `comment.text` 改为 `rawText` |

## 测试

- `tests/unit/safety/comment-normalizer.test.ts`：空格/空行剔除、@后一空格保留、表情剔除、纯表情空结果、ASCII 折叠（空格剔除后）
- `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts`：新增纯表情弹幕 `EMPTY_NORMALIZED` 丢弃用例；浮窗文本断言改为 rawText
- `tests/unit/douyin/ws-adapter.test.ts`：normalizedText 空格剔除后的期望更新

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1160 passed / 5 skipped

## 说明

- **有意变更**：`normalizedText` 语义收紧（剔除全部空格）可能使安全关键词/成员名跨词拼接误命中，属用户显式要求，验收以用户样本为准。
- 浮窗展示 rawText（原弹幕，含表情与空格）；审计同样保留 rawText，仅内层处理使用剔除后的 normalizedText。
