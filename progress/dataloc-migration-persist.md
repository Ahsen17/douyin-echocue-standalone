# 数据目录迁移持久化修复

> 修复用户实测缺陷：应用内迁移数据目录后，重启/重装会回退到 `%LOCALAPPDATA%\Echocue` 并重新初始化，迁移后的目录未实际使用。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入缺陷修复（非路图原子任务） |
| 分支 | fix/dataloc-migration-comment-normalize |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-25 |

## 根因

| # | 根因 | 说明 |
|---|------|------|
| 1 | 安装器 `customInstall` 每次安装/升级无条件把 `data-location.txt` 写回默认根 | 迁移后安装任何新版本，指针被静默重置，下次启动重建 C 盘旧根 |
| 2 | 指针文件与数据根同目录，`moveDataRoot` 的 `fs.cp` 把旧指针复制进新根 | 新根内形成指向旧根的陈旧「自指」副本，一旦固定指针丢失/目标不可达即回退 |
| 3 | boot 指针读取失败时静默回退默认根并重建 | 无任何日志提示，用户无法察觉迁移失效 |

## 改动

| 文件 | 改动 |
|------|------|
| `build/installer.nsh` | `customInstall` 仅在 `data-location.txt` 不存在时才写默认根（升级/重装保留用户已迁移的指针） |
| `src/main/config/DataLocationStore.ts` | `moveDataRoot` 的 `fs.cp` 增加 `filter`，排除 `data-location.txt/json`（Node 22 `fs.cp` 支持 `filter`） |
| `src/main/index.ts` | boot：指针存在但目标不可达时记录 `data root` 警告并记录生效数据根；迁移 `relaunch` 前 `await metricsHub.stopServer()` + `trayManager.dispose()`（Windows 干净退出） |
| `src/shared/ipc-channels.ts` | 新增 `ConfigGetDataRoot: 'config.getDataRoot'` |
| `src/main/config/config-control-ipc.ts` | 注册 `config.getDataRoot` 只读 handler（返回当前数据根）；`relaunch` 类型放宽并 await |
| `src/preload/main-preload.ts` | 暴露 `config.getDataRoot` |
| `src/renderer/main/components/RuntimeSection.tsx` | 数据保存位置卡片显示「当前数据目录」；修正误导文案「可在安装时选择」→「可在本页更改」 |

## 测试

- `tests/unit/config/data-location-store.test.ts`：`moveDataRoot` 不复制指针文件进新根（新用例）
- `tests/unit/ipc/preload-surface.test.ts`：`config.getDataRoot` 接线
- `tests/unit/ipc/ipc-allowlist.test.ts`：`config.getDataRoot` 加入通道清单

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1158 passed / 5 skipped

## 说明

- **有意决策**：迁移为复制不清源（新根故障时旧根是回退备份），不自动删除旧根。
- 安装期目录选择维持现状（一键安装，用户已确认）；安装路径不可选，数据目录可通过本页迁移。
- NSIS 升级保留指针需 Windows CI（package-windows.yml）实机验证。
