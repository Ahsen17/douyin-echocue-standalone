# M6 补记：浮窗展示弹幕发出时间

> 非路图插入功能任务：浮窗在 `@昵称` 旁并排展示弹幕发出时间（`hh:mm:ss`），`createTime` 缺失时兜底为本地接收时间。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入功能（非路图原子任务） |
| 分支 | fix/freshness-5s-overlay-time |
| 状态 | ✅ 已完成（PR #47 合并、master CI 通过） |
| 完成时间 | 2026-08-23 |
| 追溯 | UI §5（浮窗信息层级）；M6-07（OverlayDisplayPayload/独立浮窗）|

## 改动

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` | `OverlayDisplayPayloadV1Schema.comment` 新增可选 `sentAt`（local `HH:mm:ss`，增量向后兼容 strictObject 字段） |
| `docs/06-data-interface/schema/contracts-v1.ts` | 镜像同步（与 contracts 包 byte-identical） |
| `src/main/suggestion/format-overlay-sent-time.ts`（新） | 纯函数：`upstreamCreatedAt`（秒/毫秒自动识别）优先，缺失/非法兜底 `receivedAt`，再失败返回 undefined |
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | `display()` 构造 payload 时填充 `sentAt`（展示就绪字符串） |
| `src/renderer/overlay/App.tsx` | `@昵称` 行内右侧渲染 `sentAt`，小字号（0.8em）/降透明 |
| `src/contracts/test/schemas.test.ts` | +2 用例（带 sentAt 合法 / 超长 sentAt 拒绝） |
| `tests/unit/suggestion/format-overlay-sent-time.test.ts`（新） | 6 用例：秒/毫秒识别、兜底、优先级、非法省略 |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | 展示 payload 断言改为 sentAt 格式匹配（时区无关） |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 157 passed
- `npm run test` ✅ 1052 passed / 5 skipped

## 说明

- **时间语义**：优先 `createTime`（弹幕发出时间）；缺失时用 `receivedAt`（接收时间，与发出相差约 1~3s）——用户决策「兜底为接收时间」。
- **展示时机**：与 `@昵称` 并排；仅在昵称存在时显示该行（遵循 UI §5「无昵称隐藏该行」）。
- **契约**：`sentAt` 为可选字段，向后兼容；浮窗 renderer 仅展示，不参与任何逻辑。
