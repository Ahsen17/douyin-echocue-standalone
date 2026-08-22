# M6 修复：preload 沙箱单入口构建 + 浮窗延迟显示 + 内置中文字体

## 状态
已完成（2026-08-23），分支 `fix/preload-sandbox-overlay-show`

## 问题现象（npm run preview，WSL2）
1. 主窗口一片空白、无任何组件；浮窗自动弹出且完全透明
2. 日志：`service bootstrap failed CredentialEncryptionUnavailableError: safeStorage encryption is not available on this system`
3. 窗口能弹出且有样式后，所有中文显示为方框（口口口）

## 根因分析
- **主窗口空白**（非 WSL2 问题）：vite preload 多入口 lib 构建把 `src/shared/ipc-channels.ts` 抽成共享 chunk（`ipc-channels-*.cjs`）；Electron **sandboxed preload 只能 require electron + 内建模块，无法 require 自定义 chunk** → preload 加载失败（`module not found: ./ipc-channels-*.cjs`）→ `window.echocue` undefined → 渲染层组件全部未挂载
- **透明浮窗自动弹出**（非 WSL2 问题）：`OverlayWindow.createWindow` 未设 `show:false`，BrowserWindow 默认 `show:true`，构造即弹出透明窗口
- **safeStorage 报错**（WSL2 环境所致，设计内降级）：WSL2 无 keyring/DPAPI，`safeStorage.isEncryptionAvailable()` 为 false → `createServiceController` 抛 `CredentialEncryptionUnavailableError` → index.ts catch 后继续（gate 关闭），services=null 时主窗口各 wire*Control 未注册，渲染进程 IPC 返回 `No handler registered`。真实 Windows 目标机（DPAPI 可用）不会触发；本地 WSL2 可装 gnome-keyring 使 safeStorage 可用
- **中文方框乱码**（非 WSL2 代码问题，环境缺字体）：字体栈 `Inter,"Microsoft YaHei",sans-serif` 在 Linux 上两者皆缺（系统 89 字体无中文字体），回退 sans-serif 无 CJK 字形 → 方框。Windows 目标机自带微软雅黑不会触发，但为不依赖系统字体，内置字体

## 修复内容
- `vite.config.preload.ts` → 拆为 `vite.config.preload-main.ts`（emptyOutDir:true）+ `vite.config.preload-overlay.ts`（emptyOutDir:false），各为**单入口**构建 → Rollup 把 ipc-channels 内联进每个 preload 单文件，仅 `require("electron")`
- `package.json`：`build:preload` 串行两次单入口构建；`dev:preload` 用 concurrently 双 watch
- `src/main/windows/OverlayWindow.ts`：BrowserWindow 补 `show:false`，仅 `showSuggestion()` 时 `showInactive()` 显示
- 内置 **Noto Sans SC**（思源黑体，SIL OFL 1.1，google/fonts 变量 TTF → fontTools 转 woff2 7.5MB，字重 100-900）：`src/renderer/assets/fonts/NotoSansSC-VF.woff2` + `OFL.txt`；主窗口 `styles.css` 与浮窗 `overlay/styles.css`（新建，main.tsx 引入）各加 `@font-face`（`font-display:swap`）；字体栈改为 `Inter,"Noto Sans SC","Microsoft YaHei",sans-serif`（拉丁仍优先 Inter，中文用内置）。Vite 将字体去重为单份打进 `dist/renderer/assets/`

## 验证结果
- `npm run typecheck`：零错误
- `npm run test:contracts`：149 passed
- `npm run test`：869 passed / 15 todo
- `npm run build`：通过；`dist/preload/` 仅 main-preload.cjs + overlay-preload.cjs 两个自包含文件，无共享 chunk；字体去重为单份 `dist/renderer/assets/NotoSansSC-VF-*.woff2`（7.5MB），主/浮窗两份 CSS 均 `@font-face` 正确引用
- Electron 冒烟（WSL2 + WSLg）：preload 加载错误消失；渲染进程正常加载并调用 `service.state.subscribe`/`config.get`/`persona.list`/`diagnostics.getSummary`/`safety.get`；safeStorage 降级日志保留（环境性）；无字体加载错误

## 追溯
- 涉及：M6-07 浮窗（show:false 缺陷）、M0-01 工程基线（preload 构建）、Electron 升级后 preview 可运行验证、字体内置（两 renderer 中文渲染）
- 遗留：WSL2 本地预览中主窗口各页将因 services 不可用显示错误态（设计内 gate 关闭）；如本地需要完整功能，安装并启动 gnome-keyring 后再跑 preview
