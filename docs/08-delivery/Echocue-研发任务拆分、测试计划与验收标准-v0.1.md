# Echocue 研发任务拆分、测试计划与验收标准 v0.1

> 状态：已确认开发与验收基线；真实 POC 门禁待执行
> 适用范围：Windows x64、单机 standalone、单个抖音直播间 MVP  
> 依赖文档：《PRD》《技术调研与选型报告》《系统架构与详细设计说明书》《数据模型、接口与实时事件协议》《系统详细设计图册》《数据建模与迁移设计》《UI 信息架构与交互设计》《pre_set 初始案例数据标准》

## 1. 目标与交付判定

本计划将已确认的设计转换为可排期、可验收的研发工作。流程、数据关系、时序和 UI 交互以详细设计图册为实现依据，本计划不重复或替代其约束。MVP 的可交付不是“界面可运行”，而是在甲方授权的真实开播直播间中，完成“弹幕进入 → 安全过滤/筛选 → 回复建议与提词 → 始终置顶浮窗”的完整通路，并保留可回溯审计。

以下事项为发布门禁：

1. 真实 `douyinLive` 接入 POC 已通过；未开播不得启动服务，`ROOM_OFFLINE` / `ROOM_ENDED` 必须立即关闭 WS 并停止服务。
2. 所有进入系统的弹幕均有完整审计链；审计库不可写时立即停止 AI 服务。
3. 高风险、个人信息和禁忌规则命中的弹幕在检索/模型调用前过滤，且无浮窗建议。
4. 有效候选的端到端 P95 以 3 秒为优化与验收目标；未达到时必须继续定位和优化，不将未达标视为默认可接受结果。
5. `golden_set` 高置信命中可直出，其他候选至多一次 LLM 调用；不得展示过期排队建议。
6. Windows x64 安装包可一键初始化本地 SQLite/Qdrant sidecar，托盘关闭、显式退出和 SVG 图标行为符合 PRD。

## 2. 分期与门禁

| 阶段 | 目的 | 退出条件 | 是否可进入下一阶段 |
| --- | --- | --- | --- |
| P0 工程基座 | 建立 Electron/Vite/React/TS、打包、日志和本地配置。 | Windows x64 安装包可启动、卸载/升级冒烟通过。 | 是。 |
| P1 外部接入 POC | 用真实开播房间验证 `douyinLive` 生命周期和评论事件。 | 连续 30 分钟记录完整，状态门禁与 WS 关闭证据齐全。 | **通过后**进入端到端主链路。 |
| P2 本地数据与检索 POC | 验证 SQLite 审计、Qdrant sidecar、jieba-BM25。 | 迁移/恢复、双 collection、FastEmbed hash fixture 和中文检索基准通过。 | 是。 |
| P3 业务闭环 | 实现规则、路由、人设版本、工作流、浮窗和 Provider fallback。 | 模拟流端到端测试通过，审计状态机完整。 | 是。 |
| P4 真实场景优化 | 以真实直播间和真实样本调优时延、质量和检索阈值。 | 达到验收集与 P95 业务目标，或形成可复现差距与优化结论。 | 进入候选发布。 |
| P5 发布验收 | 安装包、回归、安全、人工验收。 | 第 6 节全部 P0/P1 验收项通过。 | 可交付 MVP。 |

P1 未通过不阻止 P0/P2 的本地开发，但阻止声明“可用于真实直播”。

## 3. 研发任务拆分

### W1：工程基座与 Windows 打包

**实现**

- 建立 Electron main / preload / renderer 三进程边界，renderer 使用 React + Vite + TypeScript。
- 建立受限 IPC 白名单、运行日志脱敏、开发/生产配置隔离；以 `zod` 承载 06 的 canonical TypeScript schema，Main/preload/Renderer 复用同一 contract package。
- 建立本机诊断摘要与可选 Prometheus/OTel exporter；指标只含状态、计数、错误类别和耗时，不含原文、`trace_id`、API Key 或高基数标识。
- 将固定版本/SHA/许可证的 douyinLive Windows x64 产物随包交付，使用 Windows Job Object 管理归本应用所有的 sidecar；不得支持外部共享进程模式。
- 接入 SVG 源文件构建为应用 ICO 和托盘 PNG；主窗口使用自绘 macOS 风格三按钮。
- 配置 Windows x64 安装、首次启动目录、升级和显式退出的资源回收。

**验收**

- 关闭主窗口或 Alt+F4 只隐藏至托盘；托盘“退出 Echocue”才停止服务并退出。
- 任务栏与托盘图标分别来自 [`../../svg/douyin-echocue-client-app-icon.svg`](../../svg/douyin-echocue-client-app-icon.svg) 和 [`../../svg/douyin-echocue-client-tray-icon.svg`](../../svg/douyin-echocue-client-tray-icon.svg)；无运行时 SVG 兼容依赖。
- 未记录 API Key、弹幕、人设原文或审计明文到常规日志。
- 诊断页能显示连接/运行状态、最近接收/处理时间、最近端到端耗时与可复制的脱敏错误摘要；Prometheus/OTel 可开启、关闭且通过敏感属性反向测试。

### W2：服务状态机与 douyinLive 接入

**实现**

- 实现唯一 lifecycle `STOPPED → GATE_CONNECTING → RUNNING` 与独立 activity `IDLE/GATE_CHECKING/LISTENING/RETRIEVING/GENERATING/DISPLAYING`，并审计转换。
- 包装 `douyinLive` 受控 sidecar 与本地 WebSocket adapter，仅由用户点击启动创建进程/连接，停止时先关 WS 再终止本应用子进程。
- 处理 `ROOM_ONLINE`、`ROOM_OFFLINE`、`ROOM_ENDED`、`WebcastChatMessage`；礼物/点赞记录为非主链路事件，不触发建议。
- 去重 `msgId`，处理 malformed event、连接错误和手动停止。

**验收**

- 未收到有效 `ROOM_ONLINE` 前，服务不进入 `RUNNING`。
- `ROOM_OFFLINE` / `ROOM_ENDED` / Stop / WS 异常时关闭连接、隐藏浮窗、停止处理；不自动重连。
- P1 连续 30 分钟证据包含事件总数、评论数、重复数、状态事件、错误摘要、事件时间与关闭 WS 时间。

### W3：SQLite、人设版本与审计存储

**实现**

- 在 `AuditStoreWorker` 中实现 migration、WAL、事务、加密 envelope、HMAC 链与读模型。
- 实现团队成员、人设 draft/publish/回滚为新版本、服务启动快照和人设路由所需别名配置。
- 实现 trace、状态迁移、检索结果、LLM 请求/响应、浮窗、反馈与 Qdrant transactional outbox。

**验收**

- 空库、升级库、重复启动和异常退出恢复均不破坏迁移或哈希链。
- 直播中发布人设不影响本场会话；停止后重新启动才切换新版本。
- 任一审计写失败触发 `E_AUDIT_UNAVAILABLE` 并停止 AI 服务。

### W4：安全规则、弹幕归一与成员路由

**实现**

- 实现版本化 `SafetyPolicyVersionV1`、内置隐私/辱骂等类别、关键词/短语、受控 regex、自然语言规则确定性编译器和稳定风险原因码。
- 实现文本 regex 清理、Unicode NFKC、别名精确匹配、高可信模糊匹配、歧义/低可信回退主要出镜人员。
- 配置主播、昵称、团队成员和自定义禁忌为自然语言/关键词可编辑内容；无法解释的自然语言规则标为 `INVALID`，阻止发布与启动。

**验收**

- 每个风险类别至少有五条正反样本；覆盖 Unicode 变体、PII、regex 边界和编译失败；高风险样本无 Qdrant/Provider/浮窗副作用。
- 精确昵称、配置变体、未点名、歧义别名、低可信错别字均遵循 PRD 路由规则。

### W5：jieba-BM25 与 Qdrant 双 collection

**实现**

- 打包并由 main process 管理 loopback-only Qdrant sidecar；健康检查、初始化和失败门禁。
- 在 worker 中初始化 `jieba-wasm` 一次，使用 `cut_for_search`；主播昵称、别名和热词写入自定义词典并纳入 profile 版本。
- 实现 regex → Unicode → jieba → FastEmbed 对齐 MurmurHash3 x86 32-bit token ID → BM25 文档侧权重的写入链路。
- collection 开启 `modifier.IDF`；查询 token 去重、每个值为 `1`，由 Qdrant 计算 IDF。
- 实现 `pre_set` / `golden_set` 并行检索、payload filter、calibration、rerank、直出门槛和 outbox 幂等 upsert。
- 按严格 JSON Schema 整包校验 `pre_set`，顺序固定为 staging/基线计算 → 创建临时 collection/index → upsert/fixture 校验 → 原子切换 active alias；禁止先导入后建 collection。

**验收**

- `murmurhash3js-revisited` 的 UTF-8、seed=0、signed-to-abs 行为通过 FastEmbed/Python `mmh3` fixture（中文、emoji、ASCII）。
- `pre_set` 只读；golden 修正/高分回流立即可检索；被拒绝的 golden 直出 point 被 `is_bad_case=false` filter 排除。
- 每次打标不重建 collection；`avg_doc_len_baseline` 由初始 `pre_set` 固化。profile 变更时才走新版本批量重编码与原子切换。
- Qdrant 不可用拒绝启动；两库 raw score、calibration 和最终 TopK 写入审计。

### W6：实时工作流、Provider 与浮窗

**实现**

- 实现滚动最新窗口、展示期抑制生成、deadline/cancel token 和过期候选丢弃。
- 并行读取人设快照和双路检索；golden 高置信命中通过当前安全/长度/禁忌复验后直出，否则仅一次选定 Provider 调用。
- 实现 `TextGenerationProvider`、`ProviderConfigV1`（服务商名称、adapter type、Base URL、Model ID、凭证引用）、首个 DeepSeek adapter、5 秒保险上限/新鲜度取消、结构化输出校验和统一错误分类；MVP 响应出现 `tool_calls` 必须按 `PROTOCOL` 失败，完整 Tool Call adapter 移入后续 backlog。
- 实现 always-on-top 浮窗：存在昵称时显示 `@昵称`，新建议出现即展示，默认 10 秒可配，窗口到期隐藏；支持拖拽、宽高、透明度、字号、深浅主题、点击穿透及偏好持久化/跨屏安全回退。

**验收**

- 展示期弹幕仍创建审计 trace，但不生成或排队下一条建议。
- 新窗口只挑选仍在 `window_max_age_ms` 内的候选；无旧消息补发。
- golden 直出为零次模型调用；其余有效候选恰好一次；超时/错误不重试、不展示。
- 建议包含短回复与提词；昵称有/无值均符合显示契约；全部浮窗偏好重启后保留，首帧呈现且保持置顶。

### W7：审计工作区、打标与回流

**实现**

- 在审计工作区提供 workflow 完整上下文入口和打标入口。
- 支持 `UNLABELED`、`ACCEPTED`、`REJECTED`、`CORRECTED`、`NOT_APPLICABLE` 筛选，保留反馈修订。
- 将认可高分和修正答案通过 outbox 回流 golden；内部同步状态和 bad-case 机制不暴露给用户。

**验收**

- 可从任一建议追溯：原始弹幕、路由、规则、两库 TopK、分数、PE、模型输出、校验与浮窗结果。
- 拒绝无修正只在本次 golden 直出时标坏该 point；LLM/pre_set 路径绝不改写通用案例。
- 同一反馈重试不产生重复 golden point 或重复 job。
- 审计页不存在导出/清空入口，不显示 golden、bad case、同步、阈值；访问原文前展示本机授权提示。

## 4. 测试计划

### 4.1 自动化测试层级

| 层级 | 重点 | 最低要求 |
| --- | --- | --- |
| Unit | BM25、规则、路由、状态转移、加密 envelope、输出校验。 | 覆盖所有错误码和状态转移拒绝分支。 |
| Contract | douyinLive WS、Qdrant REST、Provider adapters、IPC/error/reason schema。 | 保存 JSON fixture；至少覆盖 DeepSeek + 一个替代兼容 adapter，不依赖真实 Key。 |
| Integration | SQLite+Worker、Qdrant sidecar、outbox、主进程/浮窗。 | 在 Windows x64 CI 或专用机运行。 |
| E2E 模拟流 | 多弹幕节奏、展示期、取消、直出、LLM fallback。 | 可重复、可生成审计对照。 |
| 真实 POC | 真实房间、网络、首选 Provider、真人审查。 | 甲方授权、全程脱敏日志。 |

### 4.2 必备测试集

甲方提供的 `pre_set` 之外，研发建立可版本化的测试集。每条样本最少含输入、预期规则动作、预期路由、预期语义类别和是否可产生建议。

| 集合 | 覆盖内容 | 最低数量/要求 |
| --- | --- | --- |
| Risk | 个人信息、侮辱/攻击、禁忌、自定义关键词及边界表达。 | 每类至少 5 条，含正反例。 |
| Route | 主播名、别名、同音/错别字、未点名、歧义。 | 每类至少 5 条。 |
| Retrieval | 互动、夸赞、玩笑、提问、氛围、低价值、过滤类。 | 初始 30–50 条真实或脱敏样本。 |
| BM25 fixture | token、MurmurHash ID、TF 饱和、query weight、排序。 | 覆盖中文、英文、数字、emoji、标点和 hash 碰撞诊断。 |
| Workflow | 直出、Provider、超时、展示抑制、展示后 `HIDDEN`、展示前 deadline 丢弃、审计失败。 | 每条 canonical 状态转移至少一例。 |

### 4.3 时延与稳定性测量

每条 trace 记录下列单调时钟时间：`t0` client 收到原始 WS frame、`t1` 规则/路由完成、`t2` 两路检索完成、`t3` Provider 完成或直出、`t4` 审计提交、`t_end` overlay 首帧确认。报告 P50/P95/P99、失败率与样本数；上游 `createTime` 单独报告但不计入本地 SLO。

| 阶段 | P95 起始预算 | 主要优化手段 |
| --- | ---: | --- |
| 规则/路由/归一 | ≤100 ms | 预编译规则、内存快照、worker 初始化 jieba。 |
| 检索 + 人设读取（并行） | ≤150 ms | loopback Qdrant、并行请求、payload index。 |
| prompt/本地校验 | ≤100 ms | 固定 schema、长度约束。 |
| 单次 Provider | ≤2,300 ms | 模型/提示词调优；5,000 ms 保险上限且服从新鲜度 deadline。 |
| 审计 + 浮窗首帧 | ≤350 ms | Worker 事务、轻量渲染。 |
| 有效建议端到端 | **≤3,000 ms** | 优先 golden 直出、取消过期工作。 |

### 4.4 原子 testcase 目录

这些 ID 是追溯矩阵的稳定测试入口；实现时可拆为多个自动化 case，但不得复用同一 ID 表示不同目标。

| ID | 层级 | 最低覆盖与证据 |
| --- | --- | --- |
| `T-CON-001` | Contract/真实 POC | WS 事件 fixture、真实开播 30 分钟计数、ONLINE/OFFLINE/ENDED、评论原文审计。 |
| `T-CON-002` | Integration/E2E | 仅手动启动持有 WS；未开播、停止、下播、源异常均关闭 WS/sidecar；不自动恢复。 |
| `T-SAFE-001` | Unit/Contract/E2E | Safety fixtures、编译成功/失败、输入/输出复验、PII/禁忌/fail-closed 与版本快照。 |
| `T-PER-001` | Unit/Integration | 主要出镜兜底、别名/同音错字、多人版本发布、回滚生成新草稿/版本、会话快照不热切换。 |
| `T-RET-001` | Unit/Integration/POC | schema 全包原子导入、跨语言 hash、双库 filter/校准/rerank、直出、bad case、单点回流幂等。 |
| `T-PROV-001` | Contract/E2E | 通用 Provider 配置、Key 不回显、DeepSeek + 替代 fixture、错误映射、5 秒 abort、Tool Call 拒绝。 |
| `T-OVR-001` | E2E/Windows | `@昵称`、首帧 ack、置顶/隐藏、完整偏好、跨屏回退、关闭到托盘与显式退出。 |
| `T-AUD-001` | Integration/E2E | 原文、状态、版本、TopK、prompt、Provider、输出、浮窗、反馈修订/outbox 全回溯；不可写即停服。 |
| `T-PERF-001` | Benchmark/真实 POC | 统一 `t0` 到 `t_end` 的 P50/P95/P99；展示期不生成、不排队旧建议。 |
| `T-QUAL-001` | 甲方人工验收 | 30–50 条真实/脱敏样本的人设一致性与建议可用性评分、修正答案及迭代项。 |
| `T-PKG-001` | Windows E2E | 一键安装/升级、manifest/SBOM/哈希、无静默下载、sidecar Job Object 与无孤儿进程。 |
| `T-STO-001` | Integration/恢复演练 | 永久本机且无导出/自动删除；容量门槛、WAL checkpoint、完整性检查和受控恢复。 |
| `T-DIAG-001` | Contract/E2E | 本机诊断空/加载/错误状态、最近时间/结果/时延、可复制脱敏错误；Prometheus/OTel 开关和敏感 label/attribute 反向测试。 |
| `T-SCOPE-001` | 范围反向测试 | 不出现自动发弹幕、多直播间/MCN 后台、云端审计、用户可见检索内部机制。 |

## 5. POC 执行与证据

### 5.1 甲方输入

1. 一个可测试的真实开播直播间及在允许范围内的测试安排；
2. 首选 Provider 的服务商名称、adapter type、Base URL、Model ID 和 API Key；
3. 当前人设、成员/昵称/别名、禁忌关键词和首批 `pre_set` JSONL；
4. 30–50 条允许本机永久审计/检索的真实或脱敏弹幕样本；
5. 对建议质量的人工评审与必要修正答案。

### 5.2 乙方输出

1. 按 [douyinLive POC 模板](../03-research/Echocue-douyinLive-Windows-x64-POC记录模板-v0.1.md) 归档 30 分钟接入记录与状态门禁证据；
2. 按 [BM25 POC 模板](../03-research/Echocue-Qdrant-jieba-BM25-POC记录模板-v0.1.md) 归档参数、`avg_doc_len_baseline`、calibration artifact 与中文误召回/漏召回报告；
3. 首选 Provider 时延、格式、超时和人工质量报告，以及 adapter contract fixture；
4. Windows x64 安装包冒烟、托盘/图标、sidecar 生命周期与审计恢复记录；
5. 按 [安全与路由 POC 模板](../03-research/Echocue-安全规则与路由POC记录模板-v0.1.md) 归档硬风险、禁忌和成员路由准确性；并输出 P0/P1 缺陷清单、复现步骤、修复状态和残余风险。

## 6. MVP 验收矩阵

| 编号 | 验收项 | 优先级 | 通过标准 |
| --- | --- | --- | --- |
| A-01 | 真实接入 | P0 | 授权开播房间连续监听 30 分钟；评论事件可审计；下播/未开播即时关闭 WS。 |
| A-02 | 启动门禁 | P0 | 配置、审计、Qdrant、开播状态任一不满足均拒绝启动且给出可理解提示。 |
| A-03 | 风险过滤 | P0 | 风险/隐私/禁忌样本 100% 在模型前拦截，且无浮窗。 |
| A-04 | 人设路由 | P0 | 路由测试集符合指定成员/主要出镜兜底规则。 |
| A-05 | 检索与回流 | P0 | 双库 filter、TopK、calibration、golden 直出、bad case 行为均有审计和自动化证据。 |
| A-06 | 时效 | P0 | 有效建议 P95 ≤3 秒；无展示后排队旧建议。 |
| A-07 | 审计 | P0 | 可完整回溯 workflow；审计不可写即停服；打标不重复且回流幂等；无导出/清空入口，普通 UI 不显示 golden/bad-case/sync/threshold。 |
| A-08 | 浮窗与托盘 | P1 | 置顶、`@昵称` 有/无值、默认 10 秒隐藏、拖拽/尺寸/透明度/字号/主题/点击穿透与重启持久化/跨屏回退全部通过；关闭隐藏至托盘，显式退出完整清理。 |
| A-09 | 安装与数据 | P1 | Windows x64 一键安装、初始化/升级可用；Qdrant 与 douyinLive 固定版本随包、进程所有权明确；无 Docker、无首次静默下载二进制。 |
| A-10 | 建议质量 | P1 | 30–50 条标注样本中“可直接使用或轻微修改后可用”比例以 ≥80% 为阶段目标；不足则形成优化迭代清单。 |
| A-11 | Provider 配置 | P0 | 服务商名称、adapter type、Base URL、Model ID、API Key 可配置；Key 不回显；HTTPS/重定向/host 变更安全校验通过；DeepSeek 和替代 adapter contract fixture 通过。 |
| A-12 | 容量与恢复 | P1 | 记录每千条增长量；2 GiB 启动门槛、低空间预警、256 MiB 停服、WAL checkpoint、释放空间后的完整性检查与受控本机恢复演练通过；无自动删除。 |
| A-13 | 本地诊断与观测 | P1 | FR-09 的运行状态、最近接收/处理时间、结果、时延和可复制脱敏错误可用；Prometheus/OTel 可配置且不含原文、密钥、`trace_id` 或高基数用户字段。 |

## 7. 不通过处理

- P0 项不通过：不得进入 MVP 交付；记录复现 trace，修复后回归同一测试集。
- P1 项不通过：可继续内部迭代，但不得对甲方声明该能力已验收。
- 时延未达标：按阶段时间戳定位，不允许以增加排队、延迟展示旧建议或关闭审计来规避。
- 检索质量未达标：优先补充真实样本、jieba 自定义词、规则和 calibration；profile 变更走版本迁移，不在线改写历史 point。
- 第三方接入受限：停止扩大使用范围，保留 POC 证据并由甲方决定是否继续承担接入风险或调整接入方案。

## 8. 开发完成定义（Definition of Done）

每个工作包完成前必须同时满足：代码通过静态检查与相关自动化测试；接口/数据契约变更同步更新文档；错误路径具备用户提示和审计；涉及真实内容的日志脱敏；Windows x64 打包冒烟通过；相关验收 evidence 可由甲方复核。任何临时 mock、硬编码 API Key、跳过审计或绕过启动门禁均不构成完成。
