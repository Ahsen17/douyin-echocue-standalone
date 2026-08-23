# M6 发布记录：v0.1.0-beta.6（DRAFT，未公开）

## 信息

| 字段 | 内容 |
|------|------|
| 版本 | v0.1.0-beta.6 |
| 状态 | **DRAFT**（已创建，未公开；等待维护者审核后发布） |
| 触发信号 | `PUBLISH v0.1.0-beta.6`（用户显式授权，保留 draft） |
| Tag | `v0.1.0-beta.6`（指向 master HEAD `f0d5ad7`） |
| 构建方式 | 推送 tag 触发 `release-windows.yml`（Windows runner 全量构建+验证） |
| Workflow | run `32656338483`（success） |
| Release URL | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.1.0-beta.6 |

## 资产

| 资产 | 说明 |
|------|------|
| `Echocue Setup 0.1.0.exe` | NSIS 一键安装包（未签名 unsigned）SHA-256 `a0a3d60a…6f14` |
| `manifest.json` / `hashes.json` | `release:manifest` 产物（安装包与随包资源哈希） |
| `licenses.json` / `sbom.cdx.json` | `compliance` 产物 |
| 源码 zip / tar.gz | GitHub 对 tag 自动生成 |

## 本批次变更（随此发布）

- 浮窗倒计时/高度/默认位置（PR #54）
- 诊断页格式与集合样本数、运行页耗时精度（PR #55）
- 审计打标表单 AI 建议内嵌（PR #56）
- 提示词昵称独立字段、移除 id/version/contract（PR #57）
- 人设昵称随草稿保存、发布无需先存草稿（PR #58）

## 发布说明要点

- 安装包为未签名预发布版本；Windows SmartScreen 提示「未知发布者」，指引「更多信息 → 仍要运行」。
- 不含 API Key、真实弹幕/人设/昵称、`trace_id` 或真实业务原文。
