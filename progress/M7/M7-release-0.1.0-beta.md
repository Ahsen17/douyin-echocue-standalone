# Release 记录：v0.1.0-beta

> 按 `.claude/rules/release.md` §3 执行；记录发布事实，不含真实业务数据/密钥。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `0.1.0-beta` |
| tag | `v0.1.0-beta`（annotated，指向 master HEAD `2d311de`） |
| 触发 | 维护者 `PUBLISH 0.1.0-beta` 信号 |
| 发布 workflow | `release-windows.yml`，run `32627985947`（success） |
| 公开时间 | 2026-08-23T08:32:53Z（draft → 维护者确认后公开） |
| Release URL | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.1.0-beta |

## 发布资产

- `Echocue.Setup.0.1.0.exe`（NSIS 一键安装包；发布前已过 `package:verify` + T-PKG-001：安装/启动/退出无孤儿/升级/卸载）
- `manifest.json` / `hashes.json`（SHA-256 与版本清单）
- `licenses.json` / `sbom.cdx.json`
- 源码 `zip` / `tar.gz`（GitHub 对 tag 自动生成）

## 说明与边界

- 安装包 **unsigned**（无代码签名证书）；发布说明含 SmartScreen「更多信息 → 仍要运行」指引。
- 实时链路/检索校准仍待甲方真实数据（M2-06 / M3-09 / M4-05 阻塞项），发布说明已标注。

## 追溯

- `.claude/rules/release.md` §3；`.github/workflows/release-windows.yml`；A-09。
