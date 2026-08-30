# 历史建议浮窗停止即隐藏（history-close-on-stop）

> 服务停止后，历史建议浮窗不再保留空窗口挂在桌面，而是即时隐藏；服务再次进入 RUNNING 时重新显示。这是对 history-window 任务「停止保留空窗口」决策的确认变更（原已知限制已注明「可改为停止即隐藏，需用户确认」，本次由用户确认实施）。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入任务（非路图原子任务） |
| 分支 | feat/slider-history-close |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-30 |

## 需求与决策

| 决策 | 结论 |
|------|------|
| 停止行为 | 服务停止后历史浮窗**立即隐藏**（清空内容），再次 RUNNING 重新显示 |
| 实现方式 | 复用既有 `HistoryWindow.hide()`（eager-hidden 窗口模式，不销毁重建） |
| 触发点 | `cleanupOnStop`（`ServiceController.performStop` 在所有停止路径统一调用） |

## 设计要点

- **唯一且完整的停止钩子**：`ServiceController.performStop()` 对用户停止（USER_STOP）、直播间离线（ROOM_OFFLINE）、下播（ROOM_ENDED）、数据源错误（SOURCE_ERROR）、退出（doQuit → stop）全部先调用 `cleanupOnStop` 再 `enterStopped`。在 `main/index.ts` 的 `cleanupOnStop` 补 `historyWindowInstance?.hide()` 即可覆盖所有停止路径。
- **与 overlay 对齐**：实时 overlay 已在 cleanupOnStop 中 `hideSuggestion()`；本次补齐历史窗口隐藏，两浮窗行为一致。
- **时序**：隐藏先于 STOPPED 状态广播；窗口不销毁，服务再运行时 `show()`（RUNNING 状态监听）仍生效。
- **数据**：`historyController?.clear()` 保留，停止即清空 feed；隐藏窗口后 renderer 不再接收后续事件（`isReady()` 为 true 时仍会 push，但窗口不可见）。

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/main/index.ts` | `cleanupOnStop` 补 `historyWindowInstance?.hide()`，更新注释 |
| `src/main/windows/HistoryWindow.ts` | 类文档注释同步「停止即隐藏、feed 清空」 |
| `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md` | §5.1 打开方式：停止后窗口保留空内容 → 立即隐藏（再次运行重新显示） |

不改：路图、契约 schema、IPC 通道、HistoryConfig 设置、历史窗口容量/偏好、OverlayWindow 单条展示。

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 201 passed
- `npm run test` ✅ 1210 passed / 5 skipped（跳过项为既有 sidecar 二进制依赖与 Windows 安装类测试）

## 已知限制与后续

- `HistoryWindow.hide()` 已有单测（T-HST-001「hide() hides the window」）；`cleanupOnStop` 在所有停止路径被调用由 `tests/unit/service/service-controller.test.ts` 覆盖。新增的 `hide()` 接线位于 Electron 入口 `index.ts`，与既有 `overlayWindowInstance?.hideSuggestion()` 同属入口组装层，遵循同先例不新增单测。
- history-window 任务的进度文档保持历史记录不变；本次变更独立登记于本文档与 README 追加行。
- 手动确认项：服务运行时历史窗口显示；停止后即时消失；再次运行重新显示。
