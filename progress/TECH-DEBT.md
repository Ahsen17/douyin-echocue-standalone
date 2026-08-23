# 技术债务登记

> 记录已确认、但暂不修复的工程缺口。每项含影响、修复方向与关联任务，供后续排期。

| ID | 标题 | 影响 | 状态 |
| --- | --- | --- | --- |
| TD-01 | 运行页门禁展示与真实门禁不一致 | 用户误判「门禁均已通过」，启动失败原因在运行页不可见 | 待排期 |
| TD-02 | 启动失败具体错误在 UI 不可见 | 诊断页 `lastDomainError` 从未填充；运行页仅「未启动；可手动重试」 | 待排期 |
| TD-03 | Prometheus / OTel 指标未实际启用 | `EchocueMetrics` 与 `initOtel` 仅定义未接线；无 `/metrics` 端点 | 待排期 |
| TD-04 | 主进程日志无保留策略 | 每日一份日志无限增长，长期占用磁盘 | 待排期 |

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

## TD-04 主进程日志无保留策略

- **现象**：主进程日志按本地日期写入 `<userData>/logs/main-YYYY-MM-DD.log`（PR #41），但无滚动清理，长期运行日志无限增长。
- **影响**：磁盘占用持续累积；对 standalone 客户端不友好。
- **修复方向**：追加保留策略（如保留最近 14 天，删除过期文件），启动时或每日滚动时清理。
- **关联**：PR #41（主进程日志落盘）。
