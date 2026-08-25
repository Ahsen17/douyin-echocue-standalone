# 发布记录：v0.1.0（正式版 / Latest）

> `PUBLISH v0.1.0 正式版 latest` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.1.0`（tag `v0.1.0`，正式版 stable，Latest） |
| 目标 commit | `2e0fc4b`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/echocue-standalone/releases/tag/v0.1.0 |
| 公开时间 | 2026-08-25T05:06:38Z |
| workflow | release-windows.yml run `32811040542`（Windows runner 全量构建+验证+创建 draft，随后公开） |

## 资产（Release 已附带）

- `Echocue.Setup.0.1.0.exe`（NSIS 一键安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`cad593a9cf20a5070b2e7384687599d15f62629dc2ececabb502bd15945b54dd`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引（开发/预发布状态说明，非安装包缺陷）。

## 内容范围

- 覆盖 PR #69（本批次两个插入缺陷修复）：
  1. 数据目录迁移持久化（迁移后重启/重装保持新数据路径，不再回退默认 C 盘目录）。
  2. 弹幕表情/空格规范化（`[方括号]` 表情与多余空格不计入正文、纯表情弹幕审计丢弃、浮窗显示原弹幕）。
- Release 说明仅含功能摘要/资产清单，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、package:verify + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
