# M7-08 Windows 安装、升级、退出和兼容测试

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M7-08 |
| 任务名称 | Windows 安装、升级、退出和兼容测试 |
| 状态 | ✅ 已完成 |
| 完成时间 | 2026-08-23 |
| 分支 | feat/M7-08-09 |
| 前置 | M0-04 / M7-04 |
| 追溯 | T-PKG-001、A-09；RUNBOOK §3/§4/§8；安装包清单 §3–§4 |

## 产出文件

- `electron-builder.yml`（新）— NSIS oneClick 每用户一键安装；`extraResources` 随包 sidecar/迁移 SQL/图标；`files` 仅 dist + external 运行时 node_modules
- `src/main/util/resource-path.ts`（新）— 打包 `process.resourcesPath` / dev 仓库根 双态资源解析
- `src/main/index.ts` — `resolveAssetBinary`/`migrationPath`/qdrant 模板改 resourcePath；packaged 模式 `userData` → `%LOCALAPPDATA%\Echocue`；`--smoke-quit` 测试钩子
- `src/main/service/create-controller.ts` — 补 `qdrantConfigTemplatePath` 接线
- `src/main/storage/MigrationRunner.ts` — 打开 DB 前 `mkdirSync(dirname)`（修复首次启动 audit/ 缺失缺陷）
- `src/main/windows/{TrayManager,MainWindow}.ts` — 真实托盘/窗口图标（缺失回退 base64）
- `scripts/generate-icons.ts`（新）+ devDep `@resvg/resvg-js@2.6.2` — SVG → `build/{icon.png,tray.png}`
- `build/{icon.png,tray.png}`（生成物入库）
- `scripts/win-install-verify.ps1`（新）— 安装/启动/退出/无残留/升级/卸载验证 → `release/verify-results.json`
- `.github/workflows/package-windows.yml`（新）— Windows 打包 + verify + T-PKG-001 E2E + manifest 上传
- `tests/e2e/T-PKG-001-windows-install.test.ts` — 5 个 `it.todo` 填实（env 门控，仅打包 job 运行）
- `tests/unit/{util/resource-path,package/electron-builder-config}.test.ts`（新）
- `tests/e2e/mock-stream-harness.ts` — 端口 TOCTOU 竞态修复（既有 flake）
- `package.json`（author/scripts/icons/package:win/package:verify/release:manifest）、`.gitignore`（release/）

## 实现说明

### 安装形态（用户确认）
- NSIS `oneClick: true` 一键安装，每用户固定 `%LOCALAPPDATA%\Programs\Echocue`，不弹路径选择；`perMachine: false`、`deleteAppDataOnUninstall: false`（卸载保留永久审计数据）。
- 用户数据根 packaged 模式固定 `%LOCALAPPDATA%\Echocue`（`app.setPath('userData', …AppData\Local\Echocue)`，对齐 RUNBOOK §2.3）；dev/WSL2 与 CI 测试用显式临时 dataDir，不受影响。

### 图标管线（关闭 M1-06 延期缺口）
- 此前 `svg/` 两个 SVG 零代码引用：主窗口用 Electron 默认图标、托盘用 base64 兜底。本任务按 PRD/ARCH/DELIVERY「SVG 为唯一设计源、运行时用 PNG/ICO」补齐：`generate-icons.ts` 用 `@resvg/resvg-js` 渲染 app SVG→512 icon.png、tray SVG→32 tray.png（`currentColor` 显式替换为白色，适配 Windows 托盘）；electron-builder 由 icon.png 自动转 ICO；TrayManager 用 `nativeImage.createFromPath` 加载真实 tray.png。

### 打包资源路径修正
- 原 `resolveAssetBinary`/`migrationPath` 用 `process.cwd()`，打包后失效。新增 `resolveResourcePath(rel)`：打包走 `process.resourcesPath`、dev 走仓库根；`extraResources` 的 `to` 路径保留仓库相对子路径，单一 rel 双态一致。
- `files` 仅含 `dist/**` + `jieba-wasm`/`@qdrant`/`undici`（vite 仅 external 这三个运行时模块；undici 是 @qdrant 的 hoisted 传递依赖），其余均被打进 bundle，避免安装包携带 Linux 二进制/docs/源码。

### 关键正确性修复
- **首次启动 audit 目录缺陷**：`node:sqlite` 不创建父目录，原 `join(dataDir,'audit','audit.sqlite')` 在全新数据根下打开失败（集成测试用扁平 tmp dir 掩盖）。`MigrationRunner.run()` 打开前 `mkdirSync(dirname(dbPath))`，覆盖 AuditStoreWorker/PersonaStore/SafetyPolicyStore 三处。

### 安装 E2E 与 CI
- `--smoke-quit`：仅显式 argv 触发，4s 后复用 `doQuit()` 优雅退出路径（stop 服务→shutdown 存储→dispose 托盘→quit），供安装 E2E 程序化退出，不改变托盘交互。
- `win-install-verify.ps1`：静默安装→校验随包资源→`--smoke-quit` 启动（退出码 0 + audit.sqlite 生成）→无 qdrant/douyinLive 孤儿进程→重装升级数据保留→卸载无残留且保留审计数据→`release/verify-results.json`。
- `package-windows.yml`：npm ci → build → typecheck → compliance → icons → `package:win` → `package:verify` → 带 `ECHOCUE_PKG_DIR` 跑 T-PKG-001 e2e → `release:manifest`（M7-09）→ 上传 release/ + dist/compliance/。
- T-PKG-001：5 个 todo 填实（installer 为 x64 PE、随包资源齐全、sidecar SHA 与 assets/README 一致、无孤儿进程、升级不丢数据），`describe.skipIf(!ECHOCUE_PKG_DIR)` 仅在打包 job 运行。

### 既有 flake 修复（非本任务范围，影响验收，已记录）
- `mock-stream-harness` 用 `freePort()`（绑 0→关→重绑）存在 TOCTOU，并行 worker 偶发 `EADDRINUSE:46233` + 5s 超时。改为 WS server 直接绑 port 0 读回 OS 分配端口，消除竞态。连跑 3 次稳定。

## 测试命令

```bash
npm run typecheck && npm run test:contracts && npm run test && npm run build
# T-PKG-001 在 package-windows.yml（windows-latest）带 ECHOCUE_PKG_DIR 运行
```

全量结果：typecheck 零错误；contract 149/149；vitest 1004 passed / 5 skipped（T-PKG-001 env 门控为平台边界）；build 通过。

## 已知限制 / 偏差
- **原生 Windows Job Object 未实现**：沿用 M3-01/M4-01 记录的 taskkill tree-kill 偏差；T-PKG-001 以「无孤儿进程」可观察结果验收。
- **no-orphan smoke 未实际拉起 sidecar**：sidecar 仅用户启动服务时拉起，smoke 阶段无进程；真实启动→退出的无残留验证归 M4-05 / M7-10。
- **单版本升级代理**：CI 用同一安装包「重装不丢数据」代理升级；真实旧→新跨版本升级（含 migration）归 M7-10。
- **electron-builder 首次构建下载 NSIS/winCodeSign**：属构建期工具下载，非运行期静默下载（A-09 验收点是运行期不下载 sidecar）。
- **签名**：无代码签名证书 → 安装包 unsigned，如实记录，正式签名列 M7-09/待甲方门禁。
- CI GUI 启动依赖 windows-latest 桌面会话；若 runner 无交互会话需加 `--no-sandbox`（本批未加，若 CI 暴露则处理）。

## 自检
typecheck/contract/vitest/build 全绿（含 3 次 mock-stream 稳定性复跑）；T-PKG-001 在打包 job 的 Windows 真实安装/启动/升级/卸载链路是验收核心，依赖 package-windows.yml CI 结果。待批次内 Subagent 严格审查。

## 追溯
- W1（打包/托盘/退出）、T-PKG-001、A-09；无契约/migration schema 变更（migration 文件本身作为资源随包）。
