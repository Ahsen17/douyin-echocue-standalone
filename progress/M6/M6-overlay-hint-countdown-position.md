# M6 补记：浮窗顶部倒计时提示、高度参数生效、默认位置中偏下

> 非路图插入任务：浮窗顶部补回 prototype 一致的「展示中 · N 秒」提示并改为倒计时；修复透明浮窗高度偏好不生效；创建时默认定位为水平居中、垂直中偏下。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | feat/M6-overlay-hint-countdown-position |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-23 |
| 追溯 | UI §5（浮窗信息层级、位置「上次位置」）；M6-06/M6-07（浮窗偏好/独立浮窗）|

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/overlay/App.tsx` | 展示内容顶部新增「Echocue 提示　展示中 · N 秒」，以 `prefs.durationMs` 为起点每秒倒计时；`onHide` 清除定时器；无 display 时不渲染 |
| `src/renderer/overlay/index.html` | 内联 style：`html, body, #root { height: 100% }` |
| `src/renderer/overlay/styles.css` | 同步 `html, body, #root { height: 100% }` |
| `src/renderer/main/pages/PreferencesPage.tsx` | `OverlayPreview` 补 `minHeight: Math.min(prefs.height, 420)`，偏好页预览反映高度 |
| `src/main/windows/OverlayWindow.ts` | `createWindow` 按主屏 workArea 设置初始 bounds；抽取 `defaultOverlayPosition` 纯函数（水平居中 `x`、垂直 `(height-windowHeight)*0.6` 中偏下）；首次展示按偏好尺寸重播种（M3） |
| `tests/e2e/T-OVR-001-overlay-window.test.ts` | BrowserWindow mock 捕获构造 options；新增默认位置断言（1920x1080 主屏 → x 560 / y 528）；新增首次展示按偏好尺寸重播种断言（M3）|

## 关键设计点

- **倒计时起点**：display 事件到达时以 `prefsRef.current.durationMs` 计算总秒数。main 在 `showSuggestion` 中先 `applyPreferences` 推送偏好、再发 `OverlayDisplay`，故 renderer 侧 `prefs.durationMs` 与 main 展示计时一致；用 ref 镜像避免 React state 异步滞后（第二轮审查 M-1：`onPreference` 内同步写 ref，消除 Display IPC 同任务循环先到导致的旧值竞争）。
- **高度生效根因**：overlay 为透明窗口，`html/body/#root` 无 `height:100%` 时 `rootStyle.height:'100%'` 无法铺满窗口高度，`setSize(prefs.height)` 后可见卡片不随窗口变化。补高度链后偏好高度即时生效。
- **默认位置**：构造时以 DEFAULT 尺寸播种（settings 未加载）；首次展示按偏好尺寸重新播种，之后保留拖拽位置；`ensureOnScreen` 在播种后执行，超大偏好高度也不会把顶部推出屏幕（M3 + 第二轮 m-2）。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1065 通过、5 跳过
- `npm run build`：通过
- `T-OVR-001-overlay-window.test.ts`：9 通过（含新增默认位置断言）

## 第二轮审查修复（M-1 / m-2 / n-1）

- M-1：`onPreference` 同步写 `prefsRef.current`，倒计时不再可能从默认 10s 起步。
- m-2：`seedDefaultPosition` 先于 `ensureOnScreen` 执行，超大偏好高度时播种位置仍会被钳制在屏内。
- n-1：倒计时可显示到 0 秒，不再停留在「1 秒」。

## 未关闭风险

- 默认位置 y 系数 0.6 为经验值；如甲方有精确屏幕位置要求可再调。
- 倒计时显示在 show/hide 生命周期内与 main 展示计时近似同步，非逐毫秒校准（用户可见展示窗口剩余秒数，满足 UI 需求）。
- overlay renderer 尚无组件级测试环境，倒计时/高度链仅依赖 T-OVR 主进程定位断言与手动验证（m-3）。
