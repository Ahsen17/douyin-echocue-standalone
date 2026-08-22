# M6-11 Renderer/overlay IPC 权限和 schema 测试

## 状态
已完成（2026-08-23），分支 `feat/M6-11`，M6 里程碑收口

## 目标与范围
补齐 IPC allowlist 自动化测试，验证完成判据：**overlay 无配置/审计权限；错误 sender、未知 channel、非法字段/traceId 全拒绝**（CONTRACT §7 / ARCH §8）。

- **包含**：5 个新测试文件 + 扩展 guarded-handler 测试；1 处生产代码改动（MainWindow window:* sender 校验）；进度文档。
- **不包含**：修改/新增 channel；削弱既有 schema 校验；safeStorage WSL2 降级改进（E_SERVICE_UNAVAILABLE，留档不实施）；导航阻断（CONTRACT §7 要求但未实现，见已知缺口）。

## 现状与测试缺口（任务前核实）
IPC 权限模型已实现（`createGuardedHandler` + 9 个 `wire*Control` + overlay 最小 preload + handler 边界 schema 校验），但真实 sender 谓词、各 wire 注册、跨窗口拒绝、未知通道、preload 暴露面、window:* sender 限制、`wireStateBroadcast` 订阅/注销均无测试。发现 `MainWindow` 的 `window:close/minimize/maximize` 三个 `ipcMain.on` 未校验 sender，违反 CONTRACT §7。

## 生产代码改动（唯一）
`src/main/windows/MainWindow.ts`：三个 `window:*` handler 补 self-sender 身份校验。**send 通道采用静默忽略（fail closed）而非 throw**——send 无回执通道、renderer 无法观察 rejection，且 `ipcMain.on` listener 内 throw 会成为 main 进程未捕获异常；CONTRACT §7 的"拒绝"对 fire-and-forget 即"不执行动作"。`destroy()` 后 `this.window=null` → 任何 sender 均被忽略。

## 新增/扩展测试
| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/windows/main-window-ipc.test.ts` | window:* 三通道：注册集合精确、自身 sender 触发、外来 sender 忽略不 throw、destroy 后 fail closed、toggle-maximize |
| `tests/unit/ipc/ipc-allowlist.test.ts` | 27 个 handle 通道双向精确集合（防漏注册 + 防 stray channel）、不含 5 个广播通道、按 wire 通道表、统一未信任拒绝、跨窗口矩阵（overlay→主通道拒绝、主窗口→overlay.ack 拒绝）、每 wire 代表性 trusted 正常路径 |
| `tests/unit/ipc/ipc-schema-rejection.test.ts` | wire 边界 schema 拒绝：audit.getWorkflow/submitLabel 非 UUID v7 traceId、audit.search pageSize 越界、overlay.ack 非法 requestId、config.update 未知字段/空对象、overlay.preference.update 越界、provider.credential.set 非法 providerId/多余字段、persona.create 空白名、safety.saveDraft 空关键词；域方法不被调用 |
| `tests/unit/ipc/state-broadcast.test.ts` | subscribe 初始状态推送、onChanged 广播、destroy 自动注销（CONTRACT §7）、跳过已销毁 sender、untrusted 拒绝 |
| `tests/unit/ipc/preload-surface.test.ts` | 主窗口 surface 精确（9 组方法，无 onDisplay/onHide/onPreference/ack）、overlay surface 仅 4 方法（无任何配置/审计/服务）、各方法通道接线、unsubscribe 闭包 |
| `tests/unit/ipc/guarded-handler.test.ts`（扩展） | async handler 未信任同步拒绝（守卫先于 handler）、守卫先于 schema 校验 |

测试数据全部合成脱敏（无真实 trace_id / API Key / 弹幕原文），符合安全红线。

## 已知缺口（本次不实现，留档）
1. **导航阻断未实现**：CONTRACT §7 "主窗口禁止任意外部导航和新窗口创建"（`will-navigate`/`setWindowOpenHandler`）在 `src/main` 不存在——真实安全缺口，建议后续独立任务。
2. **sender 校验仅身份**：谓词只做 `webContents` 引用相等，未校验"窗口类型 + 受信任应用 URL"（CONTRACT §7 要求三者）。测试镜像当前真实语义。
3. **`index.ts` 谓词接线未自动化测试**：wire 测试验证 wire 函数执行给定谓词，但不断言 index.ts 把正确谓词传给各 wire（谓词为两行内联闭包、接线可目检）。
4. **`window.showMain` 文档债**：CONTRACT §7 表格列出但代码无此通道（托盘走 `TrayManager.onShow`）。白名单测试用代码实际常量。
5. **bootstrap 失败路径**：`wireOverlayControl` 无条件注册，其余仅 `createServiceController` 成功才注册（`index.ts:79` vs `94-109`）；测试独立注册各 wire。

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：899 passed / 15 todo（todo 与 2 个 skip 均为既有、与 IPC 无关）
- 新增/扩展 34 个测试全部通过

## 追溯
- CONTRACT §7（IPC 白名单/发送方校验）、ARCH §8（安全与 IPC）
- Testcase：T-AUD-001（audit traceId 白名单边界）、T-OVR-001（overlay 权限与 ack）
- Acceptance：W1、W7
- 关联：M6-01（guarded-handler）、M6-07（overlay wire/ack）、M6-09（audit.search/getWorkflow）、M6-10（audit.submitLabel）
