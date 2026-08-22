# 参与 Echocue 贡献

[English](CONTRIBUTING.md) | 简体中文

感谢贡献。本项目接受 AI 辅助编码，但每位贡献者须对最终变更的质量、验证与可审查性负责。

## 必需流程

1. 选定聚焦范围 —— 取自 `docs/08-delivery/` 里程碑计划中的原子任务，或边界清晰的修复/重构。
2. Fork 本仓库，克隆你的 fork 并创建专用分支（见 [分支与提交纪律](#分支与提交纪律)）。
3. 在聚焦范围内完成变更，且不超出任务边界。
4. 打开 PR 前运行必需检查（见 [建议验证](#建议验证)）。
5. 从你的 fork 向上游仓库发起 Pull Request，并等待 CI 通过。

不建议直接从 upstream 仓库分支发起 PR。

## 打开 PR 前必须满足的条件

只有变更已可评审，且满足以下条件时，才应打开 PR：

- 变更在其目标范围内完整。
- `npm run typecheck` 零错误通过。
- 变更涉及共享契约、schema 或 fixture 时，`npm run test:contracts` 通过。
- 相关测试通过（`npm test`）；新增行为覆盖正常、边界与失败路径。
- 变更实质影响共享或高风险行为时，覆盖率已更新或已复核。
- 不包含任何密钥、仅本地配置或无关工作。
- 提交信息与 PR 描述使用中文撰写，说明变更内容及所执行的验证。

## 建议验证

- 纯文档变更：可行时运行 `npm run typecheck`。
- 普通代码变更：可行时运行 `npm test` 与 `npm run typecheck`。
- 涉及类型、共享抽象、数据库、响应结构或契约的变更：可行时运行 `npm run typecheck` 与 `npm run test:all`。
- 较大或风险较高的变更：打开 PR 前对受影响区域执行可行范围内最强的验证 —— `npm run typecheck && npm run test:all && npm run compliance`。

## 分支与提交纪律

- 保持分支范围窄小，并与里程碑/任务计划对齐。同一里程碑的多个原子任务可经约定共享一个批次分支（例如 `feat/M2-01-02`）。
- 分支前缀约定：

| 前缀 | 适用场景 | 示例 |
| --- | --- | --- |
| `feat/` | 新功能实现（原子任务） | `feat/M1-03` |
| `fix/` | 缺陷修复 | `fix/M1-03-hmac-key` |
| `refactor/` | 重构（无功能变更） | `refactor/crypto-types` |
| `docs/` | 仅文档/进度更新 | `docs/progress-M1-03` |
| `chore/` | 构建、依赖、CI 配置 | `chore/update-deps` |
| `test/` | 补充或修复测试 | `test/M1-03-coverage` |

- 尽可能使用原子提交；提交信息使用中文并注明任务 ID（例如 `feat(M5-05): ...`）。
- 同一 PR 中避免混入无关的重构、格式调整与功能开发。
- 仅 `docs/` 分支可跳过 CI 等待；代码分支必须先通过 CI 再合并，CI 失败严禁强制合并。

## 安全与隐私红线

- 不得在代码、日志、测试输出或 Git 历史中出现 API Key、Authorization header、弹幕原文、人设文本或昵称；`trace_id` 不得出现在 Prometheus / OpenTelemetry 输出中。
- Renderer 不得访问 Node API、文件系统、数据库或网络服务；所有 IPC 必须经 preload 白名单。
- 审计库是 trace 回放的唯一事实来源 —— 审计写入保持权威，写入失败时服务必须 fail closed 而非仅记日志。
- 若 schema、migration 或 fixture 与正文文档冲突，应停止并修正文档，而非自行选择一种解释。

## AI 辅助工作

允许 AI 辅助实现。

若使用 AI 工具：

- 自行核验生成的代码，
- 运行相关检查，
- 打开 PR 前请他人（例如独立的审查者）对代码进行独立评审，
- 确保最终 PR 体现你自己的审查与判断。
