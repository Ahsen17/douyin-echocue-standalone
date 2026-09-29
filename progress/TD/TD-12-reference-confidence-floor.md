# TD-12：LLM 参考案例置信度地板（provisional）

> 技术债务批次 `feat/TD-10-11-12` 第三个原子任务（gap 插入任务，非路图原子任务）。`mergedTopK` 此前无最低置信度门槛，低相关命中全部进入 LLM 参考案例，污染提示词。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（TD-12） |
| 分支 | feat/TD-10-11-12 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-09-29 |
| 关联 | TD-10（前置：停用词改变分数分布）、M3-07（校准）、M3-09（校准落地时重推） |

## 改动

| 文件 | 说明 |
|------|------|
| src/contracts/src/schemas.ts + docs/06-data-interface/schema/contracts-v1.ts（镜像） | `internalRetrieval.minReferenceConfidence: z.number().min(0).max(1).optional()`（兼容旧 settings.json）；`ConfigViewV1` 必填；`ConfigUpdateRequestV1` 可选；注释标注 provisional |
| src/main/config/SettingsStore.ts | 默认 **0.75** |
| src/main/config/config-control-handlers.ts | view 映射 `?? 0.75`；update 合并（模式照 `semanticDiscardConfidence`） |
| src/main/prompt/types.ts | `PromptInput.minReferenceConfidence?`；`TruncationLog.excludedLowConfidence?`（仅进 `RENDERED_PROMPT` 审计快照，不进 user message） |
| src/main/prompt/PromptAssembler.ts | `renderPrompt()` 按预算截断**之前**先剔除 `confidence < floor` 的 hit，两个剔除来源分别记录 |
| src/main/suggestion/types.ts + SuggestionAttemptOrchestrator.ts | `getReferenceConfidenceFloor` 会话冻结依赖（照 WP-4 模式）；`runAttempt()` 传参 |
| src/main/service/create-controller.ts | 接线（settings 读取失败兜底 0.75） |
| src/renderer/main/run/thresholds.ts + pages/RunPage.tsx | 第 7 个可调字段「参考案例置信度地板（默认 0.75）」，0–1 校验 |
| progress/TECH-DEBT.md | 登记 M3-09 重推义务 |

## 关键设计决策

1. **过滤点在 PromptAssembler 而非 rerank**：`mergedTopK` 同时喂语义丢弃票（low_value/filter_risk）与 direct-push 门；提前过滤会让垃圾弹幕绕过 DISCARD、多耗一次 LLM 调用。回归测试锁定此行为。
2. **provisional 标注**：占位校准 `{center:0, scale:2}` 下 floor=0.75 对应 rawScore≈2.2（sigmoid⁻¹(0.75)×2）；数值含义未经真实样本验证，M3-09 校准时必须重推（TECH-DEBT 登记）。
3. **审计可观测**：被剔除的 hit 以 `{caseId, collection, confidence}` 记入 `truncationLog.excludedLowConfidence`（审计快照允许诊断数值；user message 不含任何分数）。
4. **会话冻结**：floor 在 `startSession` 时冻结，运行中改配置下次启动生效（与其余运行页阈值一致）。

## 验证

- `npm run typecheck`：0 错误。
- `npm run test:contracts`：216 通过（新增：settings 无 floor 字段兼容、floor 越界拒绝、T-SCOPE-001 白名单键新增）。
- `npm run test`：1269 通过。新增：
  - prompt-assembler 5 项：低于 floor 剔除并记录、恰等于 floor 保留（`>=`）、floor 缺省/为 0 全保留、user message 不含分数、字节稳定性；
  - orchestrator 3 项：会话冻结 + 排除低分命中、无 getter 不启用地板、**floor 不影响语义丢弃与 direct-push 判定**；
  - thresholds 表单 6 项（新增 minReference 字段校验）。
- 无敏感内容：审计快照断言不含分数/阈值/密钥泄漏。

## 已知风险

- floor 默认 0.75 是占位校准下的经验值：若运行页观察到参考案例被过度剔除或垃圾仍进入，现场调参即可（无需发版）；M3-09 校准后重推。

## 审查修复（第一轮 Subagent 审查，2026-09-29）

- 默认值 0.75 收敛为契约常量 `DEFAULT_MIN_REFERENCE_CONFIDENCE_V1`（原 5 处字面量重复，审查建议项 #9）。
- `TruncationLog` 新增 `appliedFloor`，审计快照可复现过滤条件；补 floor=1 全剔除边界测试（审查建议项 #10）。
- 残余风险（未修，记录）：守卫命中的单次检索在审计中与「无匹配」同形——门禁与状态页已提供版本不匹配的显式信号，运行中集合被替换属极小概率场景。
