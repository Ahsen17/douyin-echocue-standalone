# M7 记录：安装后 Qdrant 未初始化、pre_set 无法导入（运行期检索初始化缺口）

> 记录性质：问题调查记录（非原子任务），供后续评估如何调整；本文件不涉及敏感原文/密钥。
>
> **处置结果（2026-08-23）**：已按「方向 A」落地，见 `progress/M7/M7-qdrant-init-preset-import-fix.md`（feat/retrieval-preset-import）——Qdrant 侧车随应用启动拉起、新增 `retrieval.getStatus`/`importPreSet` IPC + RunPage 导入卡片，复用 `importPreSet`/`bootstrapPreSet` 全包原子导入；未采用方向 B（与 RUNBOOK §2.2 冲突）。

## 现象

Windows 安装包（M7-08）安装并启动应用后：

1. **Qdrant 侧车不启动、检索 profile 不初始化**：Qdrant 只在用户点击「启动服务」时由 `ServiceController.start()` 拉起；且此时 `pre_set`/`golden_set` collection 根本不存在（从未被 bootstrap）。
2. **应用内没有任何导入 pre_set 的入口**：`importPreSet`/`bootstrap`（M3-04/05 实现的检索 profile 初始化）**只被测试调用**——没有 IPC、没有 preload 暴露、没有 UI 页面、主进程未接线。
3. 因此点「启动服务」时门禁 `isRetrievalReady`（`pre_set` collection 是否存在）恒为 **false** → 服务无法启动，即使手上就有合法 pre_set JSONL 也无处导入。

## 根因链

1. M3-04/05 按路图完成了「严格导入器 + profile bootstrap」的**后端可测试实现**，但没有对应的运行期入口任务（M6 UI 页、M7 流程均未覆盖）。
2. `src/main/service/service-gate.ts` 的 `isRetrievalReady` 要求 Qdrant 健康且 `pre_set` collection 存在——这是设计内 fail-closed（无检索库不允许运行）。
3. RUNBOOK §3.1/§3.2 描述的「首次运行离线导入 pre_set → 建双 collection → 原子切换 active alias」初始化流程**未接线到应用**（既无页面/向导，也无 IPC/脚本）。

## 影响

- 安装后「启动服务」必然被门禁拒绝，用户无法进入实时链路。
- 检索链路（`pre_set` 查询、golden 直出）与回流（outbox→`golden_set`）在无 profile 时均不可用。
- 这不是 M2-06/M3-09/M4-05 等「真实数据 POC」阻塞项——**是未实现的运行期功能缺口**，与甲方数据的有无无关。

## 当前「缺数据 → 行为」对照（供后续评估）

| 未提供 | 行为 |
| --- | --- |
| pre_set JSONL（检索 profile 未初始化） | `isRetrievalReady=false`，启动被拒；且当前无任何入口可导入 |
| 已发布人设 / 安全规则 / Provider+Key / 直播间 | 对应门禁项拒绝启动（详见 service-gate.ts，各有明确错误） |
| 真实开播房间 | 门禁可过后进 `GATE_CONNECTING`，无 `ROOM_ONLINE` 则停在「未开播/连接失败」 |

## 后续调整方向（待评估，未实施）

- **A. 运行期 pre_set 导入入口**：新增 IPC + UI（或首次运行向导），复用 M3-04/05 的 `importPreSet`/`bootstrap`，在安装后初始化流程中导入并 bootstrap 双库。最贴近 RUNBOOK §3.1。需评估：pre_set 只读约束、校验失败整体拒绝、原子切换、新原子任务的边界与验收（对照 A-05）。
- **B. 允许空库降级启动**：无 profile 时以「仅监听、无检索/直出」方式放行启动，待用户后续导入再升级。需评估与「检索是核心链路」「无 pre_set 不得启用服务」（RUNBOOK §2.2 前置 2）的冲突，风险较高。
- **C. 离线/脚本导入入口**：提供受控 CLI 或运维脚本走 bootstrap（dev/排障路径），不面向普通 UI。代价小，但不满足「用户可自助初始化」。
- 任何方案都必须保持：`pre_set` 运行期只读、导入失败整体拒绝不半建、`avg_doc_len_baseline` 冻结、profile 变更走版本迁移而非在线改写（RUNBOOK §5.1/§8.2）。

## 追溯

- 相关：M3-04/05（导入器/bootstrap 后端）、M4-04（启动门禁）、RUNBOOK §2.2/§3.1/§3.2/§5.1、A-05（检索与回流验收）。
- 本记录不包含敏感原文/密钥；仅匿名环境与行为诊断。
