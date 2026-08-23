# Echocue 发布规则与发布流程 v0.1

> 生效范围：Echocue MVP Windows x64 standalone 的 GitHub Release 发布。
> 本文是发布行为的**唯一权威规则**：定义「何时可发布、由谁触发、如何发布、发布什么、如何回滚」。任何代码、CI 或工具都不得在规则之外自行触发发布。

## 1. 发布门禁（唯一触发信号）

- 发布**只由维护者显式发送的 `PUBLISH` 信号触发**，格式为：`PUBLISH <版本号>`，例如 `PUBLISH 0.1.0-beta`。
- 未收到 `PUBLISH <版本号>` 前，禁止执行：创建 tag、推送 tag、触发发布 workflow、创建或公开 Release、上传任何发布资产。
- 版本号必须符合语义化/预发布命名（`MAJOR.MINOR.PATCH[-prerelease]`，如 `0.1.0-beta`），语义与 `package.json` 的 app 版本一致；预发布后缀（`-beta`/`-rc`）用于非正式发布。
- 收到 `PUBLISH <版本号>` 即授权按本文 §3 执行；不授权任何超出本文范围的操作。

## 2. 发布前置条件（全部满足才可执行）

| # | 条件 |
|---|------|
| P1 | 目标 commit 的 master CI 全绿（Test on Windows + Package on Windows）。 |
| P2 | 版本号来自 `PUBLISH` 信号；git tag 与版本一一对应（`v<版本>`）。 |
| P3 | 安装包真实通过 `package:verify`（安装/启动/退出无孤儿/升级/卸载）与 T-PKG-001。 |
| P4 | 无代码签名证书 → 安装包如实 `unsigned`（manifest 标注）；发布说明必须提示 SmartScreen 警告与处理方式。 |
| P5 | Release 不包含任何敏感内容（无 API Key、无真实弹幕/人设/昵称、无 `trace_id`、无真实业务原文）。 |
| P6 | manifest/hashes/SBOM 已随包生成并随 Release 发布（A-09 证据）。 |

## 3. 发布流程（GitHub 原生构建，无需本地 Windows 构建）

1. **实现/核对发布 workflow**：`.github/workflows/release-windows.yml`，tag `v*` 触发，步骤为 `npm ci → build → typecheck → compliance → icons → package:win → package:verify → T-PKG-001 → release:manifest → gh release create`（资产见 §4）。若该 workflow 尚不存在，先走 `chore/` 分支 + PR + CI 合并后再继续。
2. **创建并推送 tag**：`git tag v<版本>` 指向待发布 commit（通常为 master HEAD），`git push origin v<版本>`。
3. **等待发布 workflow 完成**：workflow 在 Windows runner 上**重新构建并验证**；任一验证失败则 workflow 失败、不产生 Release。
4. **创建 Release（draft）**：`gh release create v<版本> <安装包+manifest+hashes+SBOM> --target <commit> --generate-notes`；GitHub 对 tag 自动生成源码 `zip`/`tar.gz` 归档。
5. **维护者审阅 draft**：核对资产清单、Release 说明、签名提示（SmartScreen）。
6. **公开 Release**：维护者确认后 `gh release publish v<版本>`。
7. **记录**：在 `progress/` 追加发布记录（版本、commit、Release URL、资产 SHA 摘要）；不写真实业务数据、不贴完整 CI 日志。

## 4. Release 资产

| 资产 | 来源 |
|------|------|
| `Echocue Setup <版本>.exe`（NSIS 一键安装包） | `electron-builder` 输出 `release/` |
| `manifest.json` / `hashes.json` | `npm run release:manifest` |
| `licenses.json` / `sbom.cdx.json` | `npm run compliance` |
| 源码 `zip` / `tar.gz` | GitHub 对 tag 自动生成（无需手动上传） |

安装包内容与运行时约束遵循《Echocue-Windows 部署运行与故障处理手册》：sidecar/迁移 SQL/图标随包 `extraResources`、运行期不静默下载、用户数据在 `%LOCALAPPDATA%\Echocue` 等。

## 5. 签名与安全

- 当前无代码签名证书 → 安装包 `unsigned`（manifest 如实标注）。Windows SmartScreen 会提示「未知发布者」；发布说明给出「更多信息 → 仍要运行」指引，并注明这是开发/预发布状态，非安装包缺陷。
- 发布说明与 Release 描述不得包含 API Key、真实弹幕/人设/昵称、`trace_id` 或任何真实业务原文。
- 正式代码签名（`CSC_LINK`/`CSC_KEY_PASSWORD`）接入后，本规则 §5 更新为「已签名」并写明签名主体。

## 6. 回滚与恢复

- Release 默认 **draft** 先行；发现问题直接 `gh release delete`（不会删除源码，源码归档随 tag 存在）。
- tag 已推送后需撤下：删除远端 tag 与本地 tag，避免再次触发 `v*` workflow。
- 已公开的 Release 不建议删除后重发同名（URL 一旦公开即持久并被缓存/索引）；优先修订说明或发布新预发布版本。

## 7. 禁止项

- 任何自动发布：CI 不得在无 tag 推送时创建 Release（当前 `package:win` 保持 `--publish never`，仅 tag 触发的发布 workflow 可发布）。
- 未经 `PUBLISH <版本号>` 信号创建 tag 或 Release。
- Release 资产包含敏感原文、未经验证的安装包，或伪造签名。

## 8. 追溯

- 关联：M7-08（打包/安装）、M7-09（manifest/SBOM）、A-09；《Echocue-Windows 部署运行与故障处理手册》。
- 本规则不修改路图；发布是否进行由维护者信号决定，不因任务完成而自动发生。
