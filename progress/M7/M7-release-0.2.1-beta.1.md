# 发布记录：v0.2.1-beta.1

> `PUBLISH v0.2.1-beta.1` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.2.1-beta.1`（tag `v0.2.1-beta.1`，预发布 beta，公开为 prerelease/preview，非 Latest） |
| 目标 commit | `b976d9f`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/douyin-echocue-standalone/releases/tag/v0.2.1-beta.1 |
| 公开时间 | 2026-08-31T14:32:57Z（draft → 维护者确认后公开为 prerelease） |
| workflow | release-windows.yml run `33402465963`（Windows runner 全量构建+验证+创建 draft） |

## 资产（Release 已附带）

- `Echocue.Setup.0.2.1-beta.1.exe`（NSIS 一键安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`63ee3501f306038a6dd43db312bcf82237bf2166f8c9e8a0320c239fb5c10551`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`（manifest `signature: unsigned` 标注）；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引，并注明为开发/预发布状态。

## 内容范围

本次为 `PUBLISH` 发布的预发布版本，覆盖自 v0.2.0 以来的合并批次：

1. 审计语义枚举扩展 + 置信度参数配置化（PR #94）：`SemanticTypeV1` 扩展（含 `low_value` 收敛），审计语义分类与 reason 断言对齐，置信度 `center`/`scale` 参数提取到配置并加有限性校验。
2. M3 批次收尾（PR #95，docs：标记两项任务已完成）。
3. 版本提升（PR #96，`chore`：package.json `0.2.0` → `0.2.1-beta.1`）。

Release 说明仅含功能摘要/资产清单/已知限制，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 备注

- PR #96 的 package-windows 首次在 `package:verify` STEP 7/8 因已知 NSIS 卸载器自拷贝 0xC0000005 间歇崩溃，重跑后通过（非回归）。
- 当前 `gh` 无 `release publish` 子命令，公开 draft 时改用 `gh release edit --draft=false --prerelease` 完成；`--prerelease` 使 Release 归入 preview 而非 Latest。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、`package:verify` + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
