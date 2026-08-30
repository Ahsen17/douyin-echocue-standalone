# 移除运行页随浮窗弹出的「浮窗偏好」按钮

> 修复用户实测缺陷：服务运行后浮窗弹出（`DISPLAYING`）时，【服务运行】页状态卡出现预期外的「浮窗偏好」按钮，点击直达「系统设置 → 浮窗偏好」编辑页；浮窗隐藏后按钮消失。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入缺陷修复（非路图原子任务） |
| 分支 | fix/runpage-overlay-prefs |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-30 |

## 根因

`deriveRunState`（`src/renderer/main/run/run-state.ts`）在 `lifecycle === 'RUNNING' && activity === 'DISPLAYING'` 时无条件返回 `showPreferencesLink: true`。`DISPLAYING` 恰好与浮窗可见期同步（SuggestionAttemptOrchestrator 展示建议时进入 `DISPLAYING`，浮窗隐藏后回 `LISTENING`），导致状态卡「浮窗偏好」按钮与浮窗同生同灭。

## 决策

用户确认：**完全移除**该入口，RunPage 不再提供任何浮窗偏好快捷入口。

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/main/run/run-state.ts` | 删除 `RunStateView.showPreferencesLink` 字段及 `RUNNING + DISPLAYING` 分支的 `showPreferencesLink: true` |
| `src/renderer/main/pages/RunPage.tsx` | 删除状态卡中随 `showPreferencesLink` 渲染的「浮窗偏好」按钮 |
| `tests/unit/renderer/run-state.test.ts` | 用例改名为「RUNNING + DISPLAYING → 正在展示建议」，删除 `showPreferencesLink` 断言 |
| `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md` | 同步设计文档：mermaid 图删 `RUN --> QUICK[浮窗偏好快捷入口]`；最近活动卡描述删「与浮窗偏好入口」；状态映射表 `RUNNING + DISPLAYING` 主操作由「停止、浮窗偏好」改为「停止」 |

不改：主进程状态机/orchestrator/overlay、契约、`prototype/`（原型 RunPage 本无该入口）。

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1166 passed / 5 skipped（跳过项为既有安装类测试）
- `npm run build` ✅
