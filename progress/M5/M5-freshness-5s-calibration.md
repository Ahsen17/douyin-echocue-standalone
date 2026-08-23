# M5 补记：freshness 预算放宽到 5s（性能校准，非方案调整）

> 本任务为非路图插入校准任务：将整条建议的过期时间从 3s 放宽到 5s，缓解「LLM 建议几乎全部 DEADLINE_EXCEEDED 被丢弃、浮窗极少弹出」的性能问题。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入校准（性能妥协，非设计调整），非路图原子任务 |
| 分支 | fix/freshness-5s-overlay-time |
| 状态 | ✅ 已完成（PR #47 合并、master CI 通过） |
| 完成时间 | 2026-08-23 |
| 追溯 | CONTRACT §6（freshness deadline）；M5-08（deadline 公式/展示计时）|

## 根因与校准

**根因**：`freshnessDeadlineMonotonicMs = min(t0+3000, selectedAt+2500, t0+windowMaxAgeMs)`，其中 `windowMaxAgeMs=1500` 恒为最小项 → 整条 attempt 必须在弹幕到达后 1500ms 内完成。实测 DeepSeek 一次 JSON 生成延迟 1~3s，LLM 实际拿到的预算仅约 1s（真实日志实测约 981ms）→ 几乎每次建议在展示前被 `DEADLINE_EXCEEDED` 丢弃。

**校准（用户决策）**：不采用「从 min 去掉窗口驻留项」的结构改造，而是把整个过期时间放宽到 5s：

- `T0_FRESHNESS_BUDGET_MS` 3000 → 5000
- `windowMaxAgeMs`（运行时 create-controller、默认常量、SettingsStore 默认）1500 → 5000
- min 公式结构保持不变
- **生效预算**：min 公式结构不变，选中后 LLM 预算仍由 `selectedAt+2500` 决定（约 2.5s，从原 ~1.5s 提升）；5s 是 t0 锚定的整个过期时间上限，非 LLM 独占预算

**性质说明**：这是**性能妥协**（校准实验，观察浮窗出建议效果），**不是设计/契约方案调整**。设计文档（04 架构、06 契约）保持 3s 目标与原有公式不变；原因与后续优化 TODO 记录在代码常量注释处。后续优化方向：将窗口驻留与 attempt 寿命预算解耦（窗口驻留只作淘汰线，attempt 截止用 `min(t0+5s, selectedAt+2.5s)`），避免 5s 窗口候选驻留过久。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/main/suggestion/SuggestionAttemptOrchestrator.ts` | `T0_FRESHNESS_BUDGET_MS` 3000→5000；`WINDOW_MAX_AGE_MS` 1500→5000；常量注释写明原因 + TODO |
| `src/main/service/create-controller.ts` | 运行时 `windowMaxAgeMs` 1500→5000（含原因注释） |
| `src/main/config/SettingsStore.ts` | `internalRetrieval.windowMaxAgeMs` 默认 1500→5000（一致性；当前未接线进运行时） |
| `tests/unit/suggestion/suggestion-attempt-orchestrator.test.ts` | t0 cap 用例：选中时刻后调，断言 4000→6000，保持 t0 cap（现值 5000）的真实覆盖 |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 155 passed
- `npm run test` ✅ 1046 passed / 5 skipped（一次偶发环境竞态失败，单独复跑通过，与本任务无关）

## 观察与后续

- 校准效果需在 Windows 实测：观察浮窗出建议频率与弹幕时效感。
- 若 5s 窗口导致候选驻留过久/弹幕明显过期，回退或按代码 TODO 做「窗口驻留与 attempt 寿命预算解耦」优化。
