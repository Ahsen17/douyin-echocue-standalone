# 发布记录：v0.2.0-beta.2

> `PUBLISH v0.2.0-beta.2` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.2.0-beta.2`（tag `v0.2.0-beta.2`，预发布 beta） |
| 目标 commit | `50681b1`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.2.0-beta.2 |
| 公开时间 | 2026-08-30T16:22:37Z（draft → 维护者确认后公开） |
| workflow | release-windows.yml run `33321748065`（Windows runner 全量构建+验证+创建 draft） |

## 资产（Release 已附带）

- `Echocue.Setup.0.2.0-beta.2.exe`（NSIS 一键安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`449bb502efd88b0de335c42a5b8097f35f2a4b81156cbb5aeee3c09c134702d4`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`（manifest `signature: unsigned` 标注）；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引，并注明为开发/预发布状态。

## 内容范围

本次为 `PUBLISH` 发布的预发布版本，覆盖自 v0.2.0-beta.1 以来的合并批次：

1. 定制 slider 细轨道与进度填充样式（PR #88）：主应用与原型共 4 处原生 range 输入统一细轨道 + 进度填充，`--range-pct` 驱动填充比例。
2. 历史建议浮窗停止即隐藏（PR #88）：服务停止时历史浮窗即时隐藏（含 `HistoryWindow.hide()` isDestroyed 守卫修复），再次运行自动重新显示。
3. 版本提升（PR #90，`chore`：package.json `0.2.0-beta.1` → `0.2.0-beta.2`）。

Release 说明仅含功能摘要/资产清单/已知限制，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 备注

- PR #90 的 package-windows 首次在 `package:verify` STEP 7 因已知 NSIS 卸载器自拷贝 0xC0000005 间歇崩溃，重跑后通过（非回归）。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、`package:verify` + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
