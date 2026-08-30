# 发布记录：v0.2.0-beta.1

> `PUBLISH v0.2.0-beta.1` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.2.0-beta.1`（tag `v0.2.0-beta.1`，预发布 beta） |
| 目标 commit | `b330422`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.2.0-beta.1 |
| 公开时间 | 2026-08-30T14:53:02Z（draft → 维护者确认后公开） |
| workflow | release-windows.yml run `33317634493`（Windows runner 全量构建+验证+创建 draft） |

## 资产（Release 已附带）

- `Echocue.Setup.0.2.0-beta.1.exe`（NSIS 一键安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`1b85512a679e8f7a6a98e1873ffdae63cf637aac06ac343b1abcb5a82a64a80d`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引，并注明为开发/预发布状态。

## 内容范围

本次为 `PUBLISH` 发布的预发布版本，覆盖自 v0.1.0 以来的合并批次：

1. 历史建议窗口（PR #83，`feat/history-window`）：独立置顶浮动窗口，服务运行时显示、滚动展示最近 N 条成功展示建议、仅存内存不持久化。
2. 风险过滤关键词与弹幕归一化对齐（PR #81）。
3. 运行页浮窗偏好按钮移除（PR #82）。
4. 版本提升（PR #85，`chore`：package.json `0.1.0` → `0.2.0-beta.1`）。

Release 说明仅含功能摘要/资产清单/已知限制，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、`package:verify` + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
