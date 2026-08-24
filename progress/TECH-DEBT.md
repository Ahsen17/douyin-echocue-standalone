# 技术债务登记

> 记录已确认、但暂不修复的工程缺口。每项含影响、修复方向与关联任务，供后续排期。

| ID | 标题 | 影响 | 状态 |
| --- | --- | --- | --- |
| TD-01 | 运行页门禁展示与真实门禁不一致 | 用户误判「门禁均已通过」，启动失败原因在运行页不可见 | 待排期 |
| TD-02 | 启动失败具体错误在 UI 不可见 | 诊断页 `lastDomainError` 从未填充；运行页仅「未启动；可手动重试」 | 待排期 |
| TD-03 | Prometheus / OTel 指标未实际启用 | `EchocueMetrics` 与 `initOtel` 仅定义未接线；无 `/metrics` 端点 | ✅ 已完成（WP-1，PR #64，2026-08-24） |
| TD-04 | 主进程日志无保留策略 | 每日一份日志无限增长，长期占用磁盘 | 待排期 |
| TD-05 | 关键位置补充日志，方便问题排查 | 部分关键路径（边车输出、Provider 生成链路）仍无明细日志，排障慢 | 待排期 |
| TD-06 | UI 界面优化 | 运行页/配置页体验待优化，后续排期，有参考页面样式 | ✅ 已完成（PR #49，2026-08-23） |
| TD-07 | 人设已发布内容无查看入口 | 发布人设版本后无法查看具体发布了什么，只有发布表单 | ✅ 已完成（PR #49，2026-08-23） |
| TD-08 | LLM 提示词无页面化调整 | system prompt 硬编码，无法配置；user 部分涉及数据需留在代码 | ✅ 已完成（PR #49，2026-08-23） |
| TD-09 | 浮窗昵称非应用脱敏，真实用户名依赖上游接入方式 | 浮窗显示 douyin 服务端掩码昵称（如 `@x**`），主播看不到真实用户名 | 待排期 |

---

## TD-01 运行页门禁展示与真实门禁不一致

- **现象**：运行页只展示「配置完整性」（直播间 / AI 服务 / 主要出镜人设）与「检索初始化」（Qdrant 就绪）。真实启动门禁（`ServiceController.runGate`）还要求「安全与禁忌策略已发布」和「存储 ≥ 2 GiB」，这两项运行页未展示、无跳转入口，用户会误判门禁全部通过。
- **影响**：启动失败时（如 `E_SAFETY_POLICY_INVALID`）用户无法在运行页看到缺失项，只能靠猜测或额外排查。
- **修复方向**：运行页门禁清单补全「安全策略已发布」「存储空间」两项（含跳转对应页面）；或复用 `runGate` 的检查结果做展示，避免 UI 门禁与真实门禁漂移。
- **关联**：M4-04（手动启动门禁）、TD-02。

## TD-02 启动失败具体错误在 UI 不可见

- **现象**：诊断页 `summary.lastDomainError` 从未被填充——`DiagnosticsSource.recordDomainError` 在 main 进程无任何调用方；运行页对 `SOURCE_ERROR` 只显示「未启动；可手动重试」，不透出 `recoverableError.code`。
- **影响**：无日志时完全无法得知失败码（如 `E_SAFETY_POLICY_INVALID` / `E_SIDECAR_START_FAILED` / `E_SOURCE_UNAVAILABLE`）。
- **修复方向**：启动失败路径调用 `recordDomainError`，或在运行页状态卡展示 `recoverableError.code` 的中文描述。日志落盘（PR #41）缓解了排查，但 UI 层透出仍是必要的。
- **关联**：M4-04、TD-01。

## TD-03 Prometheus / OTel 指标未实际启用

- **现象**：`src/main/telemetry/Metrics.ts`（prom-client registry：commentReceived / commentFiltered / providerRequests / providerErrors / e2eLatencyMs / overlayDisplayed / sidecarCrashes）与 `OtelSetup.initOtel` 均只定义、从未被实例化或调用；main 进程无 HTTP `/metrics` 端点，无 OTLP 导出。UI 上的「指标」是 `DiagnosticsSource` 经 IPC 下发的匿名摘要，不是 Prometheus。
- **影响**：无法用标准监控工具观察运行指标；「日志、Prometheus、OTel」任务（M1-07）仅完成了定义层。
- **修复方向**：如需开放，新增本地回环 HTTP `/metrics` 端点（仅 `127.0.0.1`）或接通 OTLP 导出；严格遵循指标匿名化红线（弹幕原文、`trace_id`、密钥不得进入指标）。
- **关联**：M1-07。
- **✅ 完成（WP-1，PR #64，2026-08-24）**：`EchocueMetrics` 重写为业务/性能指标集；`SessionMetrics` 按会话累计；`MetricsHub` 聚合 + 回环 `/metrics` 服务器（默认 127.0.0.1:9100，可配置，EADDRINUSE 非致命）；orchestrator/controller 接线 hooks；监控诊断页新增「直播监控数据」区块（中文标签）。`OtelSetup.initOtel` 保持未启用（无 OTLP 导出需求）。

## 综合实施计划实现登记（2026-08-24，分支 feat/batch-rest，PR 待创建）

- WP-4：五页重构（服务运行/直播设置/系统设置/监控诊断/审计追溯）+ 运行页检索阈值配置 + 导航图标 + 审计页去门禁。
- WP-8：修复 pre_set 导入误清空 golden_set（仅首 boot 创建 golden；后续导入只重建 pre_set）。
- WP-11：AI 服务表单必填/选填 + DeepSeek 内置 Base URL。
- WP-10：风险过滤类型与关键词配置化（未配置默认不过滤，替代原内置保护词）。
- WP-5：安装位置/数据保存位置（NSIS assisted + 应用内迁移 relaunch）。
- WP-6：卸载可选清理用户数据（customUnInstall 宏 + /cleanData）。
- WP-9：本地 Windows 安装包构建脚本（WSL2+Docker / Windows PowerShell）。
- WP-7：文档同步与全量回归（本记录）。

## TD-04 主进程日志无保留策略

- **现象**：主进程日志按本地日期写入 `<userData>/logs/main-YYYY-MM-DD.log`（PR #41），但无滚动清理，长期运行日志无限增长。
- **影响**：磁盘占用持续累积；对 standalone 客户端不友好。
- **修复方向**：追加保留策略（如保留最近 14 天，删除过期文件），启动时或每日滚动时清理。
- **关联**：PR #41（主进程日志落盘）。

## TD-05 关键位置补充日志，方便问题排查

- **现象**：本次排障（启动失败 / WS 连接失败）暴露部分关键路径仍缺明细日志：douyinLive 边车自身的 stdout/stderr（`outputTail`）只在启动失败时进入错误消息，运行期不落盘；Provider/LLM 生成链路、检索、回流等路径无日志明细。每次排障常需要「加日志 → 重发版本 → 再复现」的慢循环。
- **影响**：线上/验收问题定位慢，尤其 Windows 打包环境。
- **修复方向**：对关键路径系统性补充脱敏日志（错误码 + 语义化描述 + 必要的边车输出），并覆盖边车运行期输出落盘（注意脱敏：不含弹幕原文、人设、密钥、`trace_id`）。
- **关联**：PR #41（日志落盘）、TD-02。

## TD-06 UI 界面优化

- **现象**：运行页门禁展示与真实门禁不一致（见 TD-01）、启动失败错误不透出（TD-02）、配置向导与页面引导可优化。
- **影响**：用户对「为什么不能启动 / 配置缺什么」缺乏直观反馈。
- **修复方向**：按后续提供的参考页面样式统一优化 UI（运行页状态、错误透出、配置引导、浮窗偏好等）。
- **关联**：TD-01、TD-02。

## TD-07 人设已发布内容无查看入口

- **现象**：发布人设版本后，页面只有发布表单，**无法查看具体发布了什么**（已发布版本的完整内容/历史版本）。编辑入口即发布表单，默认没有「查看」视图。
- **影响**：用户无法确认线上生效的人设内容，易误编辑或误发布。
- **修复方向**：人设页面默认进入「查看」视图，展示当前已发布版本内容与历史版本；编辑/发布作为显式动作进入表单。
- **关联**：M2-01/M2-02（人设 CRUD 与版本）。

## TD-08 LLM 提示词无页面化调整

- **现象**：`PromptAssembler` 的 system 提示词（`SYSTEM_MESSAGE_V1`）硬编码在代码常量中，用户无法调整；user 部分因组装弹幕/人设/禁忌/检索数据需留在代码。
- **影响**：提示词调优必须改代码 + 重发版本，无法由用户侧配置。
- **修复方向**：新增页面支持配置 system prompt 模板（版本化、限制长度、校验只输出 JSON 等硬约束），`PromptAssembler` 从配置读取 system 部分；user 部分保持代码组装。
- **关联**：M5-05（PromptAssembler）、LLM 提示词设计文档。

## TD-09 浮窗昵称非应用脱敏，真实用户名依赖上游接入方式

- **现象**：浮窗展示的发送者昵称为 `@x**` 这类掩码。排查确认：仓库内**无任何脱敏代码**，昵称从原始帧 `user.nickName` 原样透传（`ws-adapter.ts` → `SourceComment.userNickname` → 浮窗 payload → overlay 渲染）。`@x**` 是 **douyin 服务端隐私掩码**，由 douyinLive 边车原样转发（上游项目本身无脱敏功能、不默认要求登录态）。
- **影响**：主播在浮窗看不到发送弹幕观众的真实用户名；如需针对特定观众互动或连麦，无法直接点名。
- **修复方向**：真实用户名依赖上游接入方式——例如 douyinLive 边车启用登录态 Cookie（有凭证安全风险，需 DPAPI 保护、UI 禁止回显、日志脱敏）或更换接入方案；需另立任务评估后实施。接受现状期间，浮窗继续显示上游提供的昵称。
- **关联**：M4-02（ws-adapter）、M6-07（浮窗）、research §3.4 douyinLive 选型。
