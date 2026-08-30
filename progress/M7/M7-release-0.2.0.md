# 发布记录：v0.2.0（正式版 / Latest）

> `PUBLISH v0.2.0` 信号触发（release.md §3）。

## 发布信息

| 字段 | 内容 |
|------|------|
| 版本 | `v0.2.0`（tag `v0.2.0`，正式版 stable，Latest） |
| 目标 commit | `c661287`（master HEAD，此前 Test/Package on Windows 全绿） |
| Release | https://github.com/Ahsen17/douyin-echocue-standalone/releases/tag/v0.2.0 |
| 公开时间 | 2026-08-30T17:08:03Z（draft → 维护者确认后公开） |
| workflow | release-windows.yml run `33323857562`（Windows runner 全量构建+验证+创建 draft） |

## 资产（Release 已附带）

- `Echocue.Setup.0.2.0.exe`（NSIS 一键安装包，unsigned）
- `manifest.json` / `hashes.json` / `licenses.json` / `sbom.cdx.json`
- 源码 `zip`/`tar.gz` 由 GitHub 对 tag 自动生成

## 关键 SHA-256 摘要

- 安装包：`fcbe92ed445af51d8c51cb2395f95372b58058918b69ca277051043ff754214b`
- 其余资产哈希见 Release 附带的 `hashes.json`。

## 签名

- 当前无代码签名证书，安装包如实 `unsigned`（manifest `signature: unsigned` 标注）；Release 说明含 SmartScreen「更多信息 → 仍要运行」指引，并注明为开发/预发布状态。

## 内容范围

本次为 `PUBLISH` 发布的正式版，覆盖自 v0.1.0（含 v0.2.0-beta.1 / beta.2 已发布内容）以来的合并批次：

1. 独立置顶历史建议窗口（PR #83）：服务运行时显示，滚动展示最近 N 条成功展示建议（弹幕 + AI 回复 + 提词），容量默认 20 可配置上限 120，仅内存不持久化。
2. 风险过滤关键词与弹幕归一化对齐（PR #81）：整条拷贝风险关键词（含表情、空格、全角）均可命中。
3. 运行页移除随浮窗弹出的浮窗偏好按钮（PR #82）。
4. 定制 slider 细轨道与进度填充样式 + 历史建议浮窗停止即隐藏（PR #88）。
5. 版本提升（PR #92，`chore`：package.json `0.2.0-beta.2` → `0.2.0`）。

Release 说明仅含功能摘要/资产清单/已知限制，无弹幕原文、人设、昵称、API Key 或 `trace_id`。

## 备注

- 仓库已由 `Ahsen17/echocue-standalone` 更名为 `Ahsen17/douyin-echocue-standalone`（旧名自动重定向），本记录使用规范新名。
- 当前 `gh`（2.45.0）不支持 `gh release publish` 子命令，公开 draft 时改用 `gh api -X PATCH .../releases/<id> -f draft=false` 完成。

## 合规

- 前置条件 P1–P6 均已满足（master CI 绿、版本语义一致、`package:verify` + T-PKG-001 通过、unsigned 标注、无敏感内容、manifest/hashes/SBOM 随包）。
