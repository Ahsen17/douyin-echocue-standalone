# 发布记录：v0.1.0-meta.7

> `PUBLISH 0.1.0-meta.7` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.1.0-meta.7`（tag `v0.1.0-meta.7`） |
| 目标 commit | `46492bf`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.1.0-meta.7 |
| 公开时间 | 2026-08-24T01:50:04Z |
| workflow | release-windows.yml run `32680664396`（Windows runner 全量构建+验证+创建 draft，随后公开） |

## 资产（Release 已附带）

- `Echocue Setup 0.1.0.exe`（NSIS 安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`2d6a0ef8c06511f07f5be9fcd01c82ea13d80c0084264ca6c96c229fccdbb520`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引。

## 内容范围

- 覆盖 M6 收口审查批次（PR #54–#58）与本轮两项修复：审计打标覆盖语义（PR #60）、诊断页布局统一（PR #61）。
- Release 说明仅含 PR 标题/链接与摘要，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、package:verify + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
