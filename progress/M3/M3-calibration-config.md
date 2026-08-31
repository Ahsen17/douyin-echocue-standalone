# M3-calibration-config 置信度计算公式参数提取到配置

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M3-calibration-config（路图外插入任务） |
| 任务名称 | 置信度 sigmoid center/scale 参数提取到配置（按集合分开两组，运行页可编辑） |
| 状态 | ⏳ 已完成，待审查（批次：feat/M3-semantic-reason-calibration-config） |
| 完成时间 | 2026-08-31 |
| 分支 | feat/M3-semantic-reason-calibration-config |
| 背景 | center/scale 原为 `calibration.ts` 硬编码 POC 占位（`{0,2}`），未接入配置；随 M3-09 真实样本标定需可调。默认值与现状行为完全一致 |

## 改动摘要

置信度公式 `1/(1+exp(-(rawScore-center)/scale))` 的 center/scale 按 pre_set/golden_set 两组提取到 `settings.json` 的 `internalRetrieval`，与 `semanticDiscardConfidence` 同区，运行页可编辑，服务启动冻结生效。

- 契约：`SettingsV1Schema`（可选，兼容旧配置）、`ConfigViewV1Schema`（必填回传）、`ConfigUpdateRequestV1Schema`（可选 + superRefine 至少一项）
- 默认值：`{center: 0, scale: 2}`（与原 `DEFAULT_CALIBRATION_ARTIFACT_V1` 一致，行为零漂移）
- 生效时机：`create-controller.getCalibrationParams` 读 settings；orchestrator 会话启动冻结 `frozenCalibrationParams`，`effectiveCalibrationArtifact` 合并 center/scale + 语义丢弃阈值

## 产出文件

- `src/contracts/src/schemas.ts` + `docs/06-data-interface/schema/contracts-v1.ts`（镜像同步）— `SigmoidCalibrationV1Schema`、Settings/ConfigView/ConfigUpdateRequest 扩展
- `src/main/config/SettingsStore.ts` — defaults 追加两组 `{center:0, scale:2}`
- `src/main/config/config-control-handlers.ts` — get 回传 / update 合并进 internalRetrieval
- `src/main/service/create-controller.ts` — `getCalibrationParams` getter
- `src/main/suggestion/{types,SuggestionAttemptOrchestrator}.ts` — deps `getCalibrationParams`、冻结、`effectiveCalibrationArtifact` 合并
- `src/renderer/main/run/thresholds.ts` — 表单扩展 4 字段（preSet/goldenSet center/scale）+ 校验（center 有限、scale>0）
- `src/renderer/main/pages/RunPage.tsx` — "检索置信度阈值与校准参数"卡片新增 4 输入
- `docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md` — SettingsV1 prose 同步
- 测试：`schemas.test.ts`（calibration 往返 + scale<=0 拒绝）、`thresholds.test.ts`（4 字段重写）、`config-handlers.test.ts`（update 往返）、`settings-store.test.ts`（defaults 断言）、`suggestion-attempt-orchestrator.test.ts`（冻结参数生效）、`T-SCOPE-001-scope-reverse.test.ts`（校准参数入豁免名单）

## 测试与验证

- `npm run typecheck` ✅
- `npm run test:contracts` — 203 passed ✅
- `npm run test` — 1214 passed / 5 skipped（既有 skip）✅

## 安全说明

`goldenSetCalibration`/`preSetCalibration` 经用户决策为运行页可编辑参数（非 golden 内容/同步内部细节），已加入 `T-SCOPE-001` 的 `SANCTIONED_CONFIG_VIEW_KEYS` 豁免名单并更新注释；`SettingsV1.internalRetrieval` 内字段仍不跨 IPC。

## 批次审查结论（两轮 Subagent，全部通过）

- 第一轮：P1（scale 非有限）/P2（迁移保留测试、reason 断言）/P3 均已修复。
- 第二轮：**无 P0/P1 阻断项，可创建 PR**。补 P2-1（`validateCalibrationArtifact` 拒绝 NaN/Infinity，与 schema `.finite()` 对齐）+ P3-4（WINDOW_EVICTED 测试清理）。

## 遗留/待办（M3-09 接线前必须处理）

- **P3-1/P3-2（前向设计）**：`SettingsStore.getDefaults()` 写入 `{0,2}`，用户首次保存配置后 `getCalibrationParams` 不再返回 null，defaults 会覆盖 M3-09 注入的真实 artifact；单集合配置会强制另一集合回退 `{0,2}`。接线时需用"用户是否显式修改"标记区分默认与显式配置。
- **P3-3（既有基建）**：`tests/` 不在 `npm run typecheck` 范围，测试类型错误不可见；建议 `tsconfig.test.json` 纳入。
- **P3-5**：`getCalibrationParams` 的 null/部分配置分支无直接单测（薄读取层，null 语义由编排器测试间接覆盖）。
- center/scale 当前仍是 POC 占位（`{0,2}`），M3-09 真实样本标定前业务上未验证；本任务仅打通配置通道。
