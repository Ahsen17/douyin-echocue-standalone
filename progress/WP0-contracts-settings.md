# WP-0：契约与设置扩展（地基）

> 综合实施计划（monitoring-settings-lifecycle-plan）首个工作包。为后续监控/排队/保留期/数据位置/风险过滤/阈值配置先沉淀契约与设置读写。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 契约与设置地基（综合计划 WP-0） |
| 分支 | feat/contracts-settings |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |
| 关联 | WP-1（监控）/WP-2（排队）/WP-3（保留期）/WP-4（阈值）/WP-5（数据位置）/WP-10（风险过滤） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` | 新增 `QueueingConfigV1`/`AuditRetentionV1`/`MetricsConfigV1`/`RiskFilterTypeV1`/`RiskFilterConfigV1`/`SessionMetricsSnapshotV1`/`MoveDataRootRequestV1` schema；`SettingsV1` 增加 `queueing?/audit?/metrics?/riskFilter?` 与 `internalRetrieval.semanticDiscardConfidence?`（可选，兼容旧 settings.json）；`ConfigViewV1` 增加 `directPushThreshold/semanticDiscardConfidence/queueing/audit/metrics/riskFilter`；`ConfigUpdateRequestV1` 增加对应可选写字段（superRefine 放宽）；`TraceReasonCodeV1` 增加 `QUEUE_TIMEOUT`；类型导出 |
| `docs/06-data-interface/schema/contracts-v1.ts` | 镜像同步（byte-identical） |
| `src/main/config/SettingsStore.ts` | `getDefaults` 补新字段默认值（queueing 关/30s、audit 30 天、metrics 9100、riskFilter 空、semanticDiscardConfidence 0.9） |
| `src/main/config/config-control-handlers.ts` | `get()` 返回新视图字段（含缺省兜底）；`update()` 持久化双阈值（合并进 internalRetrieval）、queueing、auditRetentionDays、metricsPort、riskFilter |
| `src/shared/ipc-channels.ts` | 新增 `monitoring.getSessionMetrics`、`settings.moveDataRoot` 通道（wire 在 WP-1/WP-5 接入） |
| `src/contracts/test/schemas.test.ts` | +13 用例（新 schema 合法/边界） |
| `tests/unit/config/config-handlers.test.ts` | +4 用例（视图默认值、双阈值持久化、queueing/audit/metrics/riskFilter、metrics 端口越界拒绝） |
| `tests/contract/T-SCOPE-001-scope-reverse.test.ts` | 新增 `SANCTIONED_CONFIG_VIEW_KEYS`（directPushThreshold/semanticDiscardConfidence）豁免——运行页暴露双阈值属有意产品决策，与 CollectionCounts 先例一致 |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 182 passed / 0 failed
- `npm run test` ✅ 1087 passed / 5 skipped（既有 skip）

## 说明

- **向后兼容**：`internalRetrieval.semanticDiscardConfidence` 设为可选，旧 settings.json（无该字段）仍可解析；`ConfigViewV1` 视图层由 handler 落默认值，始终有值。
- **T-SCOPE-001 豁免**：运行页按产品决策暴露两个检索阈值（golden 直出 + 语义丢弃），其余 internalRetrieval/校准/窗口参数仍不跨 IPC。
- **通道延迟接线**：`monitoring.getSessionMetrics` 与 `settings.moveDataRoot` 的 wire 分别在 WP-1、WP-5 实现；ipc-allowlist 计数测试届时同步更新。
