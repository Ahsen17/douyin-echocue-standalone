# Release 记录：v0.1.0-beta.2

> 按 `.claude/rules/release.md` §3 执行；记录发布事实，不含真实业务数据/密钥。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `0.1.0-beta.2` |
| tag | `v0.1.0-beta.2`（annotated，指向 master HEAD `5ff4634`） |
| 触发 | 维护者 `PUBLISH 0.1.0-beta.2` 信号 |
| 发布 workflow | `release-windows.yml`，run `32631357658`（success） |
| 公开时间 | 2026-08-23T09:39:13Z（draft → 维护者确认后公开） |
| Release URL | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.1.0-beta.2 |

## 本次变更

- 主进程日志按日落盘到数据目录 `logs/`（PR #41，`chore/main-daily-log-file`）：`Logger` 文件输出 + 启动失败明细 + 生命周期/recoverableError 落盘。
- 技术债务登记（PR #42，`docs/tech-debt-record`）：`progress/TECH-DEBT.md` TD-01~04。

## 发布资产

- `Echocue.Setup.0.1.0.exe`（NSIS 一键安装包；发布前已过 `package:verify` + T-PKG-001：安装/启动/退出无孤儿/升级/卸载），SHA-256 `7bc914ef…0ac0c2`
- `manifest.json`（app `0.1.0` / qdrant `1.19.0` / douyinLive `2.2.0` 版本与 SHA、`signature: unsigned`）/ `hashes.json`
- `licenses.json`（646 包扫描）/ `sbom.cdx.json`
- 源码 `zip` / `tar.gz`（GitHub 对 tag 自动生成）

## 说明与边界

- 安装包 **unsigned**（无代码签名证书）；Release 说明已含 SmartScreen「更多信息 → 仍要运行」指引，并注明为开发/预发布状态。
- 实时链路/检索校准仍待甲方真实数据（M2-06 / M3-09 / M4-05 阻塞项）。

## 追溯

- `.claude/rules/release.md` §3；`.github/workflows/release-windows.yml`；A-09。
