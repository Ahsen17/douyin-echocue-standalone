# Echocue 全量交付独立审查报告 v0.2

> 审查日期：2026-08-21  
> 审查方式：以当前工作区为唯一事实源的独立、只读、逐级审查  
> 审查结论：**不满足进入全量开发/联调的文档门禁；允许在隔离分支继续不依赖冲突契约的工程基座与本地 POC。**  
> 发现统计：P0 1 项、P1 13 项、P2 8 项、P3 2 项，共 24 项。

## 1. 审查范围与方法

### 1.1 实际有效产物清单

本次将以下当前文件视为有效产物并逐项审查；`archived/` 明确视为 deprecated，仅因需求基线 `docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:9` 明确提及历史资料而抽样核对，不作为规范性真值。

| 层级 | 实际文件/产物 | 状态事实 | 本次覆盖 |
| --- | --- | --- | --- |
| Root | `docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md` | 开发基线索引 | 全文 61 行 |
| L1 需求 | `docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md` | 待甲方确认 | 全文 228 行 |
| L2 产品 | `docs/02-product/Echocue-PRD-v0.1.md` | 待甲方评审 | 全文 370 行 |
| L3 调研/选型 | `docs/03-research/Echocue-技术调研与选型报告-v0.1.md` | 待确认结论与 POC 授权 | 全文 457 行 |
| L4 架构 | `docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md` | 详细设计起稿 | 全文 295 行 |
| L5 数据标准 | `docs/05-data-interface/Echocue-pre_set初始案例数据标准-v0.1.md` | 未声明审批状态 | 全文 75 行 |
| L6 数据/接口 | `docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md` | v0.1 详细设计/开发契约 | 全文 491 行；SQL 语法执行 |
| Review | `docs/07-review/Echocue-文档体系审查报告-v0.1.md` | 旧审查，仅覆盖 docs/01–06 | 全文 36 行；不继承结论 |
| L7 详细设计 | `docs/09-design/Echocue-数据建模与迁移设计-v0.1.md` | 详细设计 | 全文 337 行 |
| L7 详细设计 | `docs/09-design/Echocue-系统详细设计图册-v0.1.md` | 详细设计补充交付 | 全文 394 行 |
| L8 UI | `docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md` | 详细设计/有原型 | 全文 265 行 |
| L9 LLM | `docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md` | 详细设计 | 全文 302 行 |
| L9 部署 | `docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md` | 开发交付基线 | 全文 213 行 |
| L10 交付 | `docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md` | 开发基线草案 | 全文 219 行 |
| L11 原型 | `prototype/README.md`、`package*.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/**` | 浏览器静态交互原型/mock | 全文件；类型检查/构建尝试 |
| 资产 | `svg/douyin-echocue-client-app-icon.svg`、`svg/douyin-echocue-client-tray-icon.svg` | PRD 指定唯一图标源 | XML 解析与引用核对 |

`prototype/node_modules/` 是依赖安装目录，`prototype/tsconfig.tsbuildinfo` 是构建缓存，不作为需求/设计产物；未把它们纳入规范性内容审查。

### 1.2 规范性层级与依赖图

发生冲突时遵循 root 规则 `docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md:8-10`：已确认的需求/决策优先于 PRD，PRD 优先于实现设计；同层以更明确的字段契约为准。实际应遵循的依赖链为：

```text
甲方书面确认/已确认需求决策
  -> 01 需求与 MVP 基线
  -> 02 PRD
  -> 03 技术调研、选型与 POC 决策
  -> 04 架构
  -> 05 pre_set 数据标准
  -> 06 数据模型、接口、实时协议
  -> 09-B 数据建模/迁移 + 09-A 系统详细设计图册
  -> 10 UI/交互
  -> 11-A LLM 实现 + 11-B Windows 部署运行
  -> 08 任务拆分、测试与验收
  -> prototype 可运行静态原型及 README
```

旧 `docs/07-review/Echocue-文档体系审查报告-v0.1.md` 是被审材料而非真值；它只审过 docs/01–06（该文件第 4 行），不能约束其后新增的 08–11 与 prototype。

### 1.3 审查动作

1. 逐行读取所有有效 Markdown、prototype 源码/配置和 SVG；建立需求、设计、接口、任务、验收的双向追溯。
2. 横向比对服务状态、单条 trace 状态、label/outbox 状态、字段/枚举、错误码、IPC、事务边界、初始化、隐私、时延、Provider、检索与 UI 行为。
3. 对全部 29 个 Mermaid fence 做围栏、首指令和基本结构检查；人工核对状态/时序语义。
4. 对 Markdown fence、表格列数、本地 Markdown 链接、相对路径和章节引用做静态检查。
5. 用 Node 24 `node:sqlite` 在内存库依次执行协议文档的两个 SQL block；解析两个 SVG 为 XML。
6. 使用仓库现有 TypeScript 依赖执行无写入类型检查；尝试 npm/pnpm/Vite 构建，不下载依赖。

## 2. 覆盖与双向追溯矩阵

| 需求主题 | 需求/PRD | 设计/契约 | 测试/任务 | 结论 |
| --- | --- | --- | --- | --- |
| Windows x64 standalone | 01 D-03a/D-19；02 FR-08/11 | 03 §4；04 §2/8；11-B | 08 W1、A-09 | 基本闭环；douyinLive 随包责任冲突，见 P1-011 |
| 手动启动、未开播关 WS、无自动恢复 | 01 D-12；02 FR-08 | 04 §3；06 §5；09-A §3/7.1；11-B §4/5.2 | 08 W2、A-01/A-02 | 通过 |
| 展示期间不生成/排队 | 01 D-07a；02 FR-05/07 | 04 §3/4.1；06 deadline；09-A；10 §5 | 08 W6、A-06 | 通过 |
| P95 3 秒、LLM 初始 5 秒 | 01 D-09/D-20；02 §8 | 03 §6；04 §9；06 §6；11-A §6 | 08 §4.3、A-06 | 目标一致，计时边界冲突，见 P1-005 |
| 不使用 Agent runtime | 01 无显式 ID；03 §4.6 | 04 §1；11-A §1 | 08 W6 | 通过；建议补到需求矩阵 |
| 人设版本化与路由 | 01 D-04a/b、D-16；02 FR-02/03 | 04 §4.2；06 DDL；09-B；10 §6 | 08 W3/W4、A-04 | 回滚被 DDL 阻断，见 P1-008 |
| SQLite 全链路原文审计 | 01 D-15/D-18；02 FR-10 | 04 §6；06 §3；09-B；11-B | 08 W3/W7、A-07 | 主体设计完整；状态/证据枚举有冲突，见 P1-004/P2-003 |
| pre_set/golden_set 独立 | 01 D-17；02 FR-05 | 03 §4.5/4.6；04 §4.3；06 §4；09-B | 08 W5/W7、A-05 | 业务规则通过；outbox DDL 可写 pre_set，见 P1-009 |
| jieba/BM25/hash/IDF/avg len | 01 D-13/D-17；02 FR-05 | 03 §4.5；06 §4；09-A §5；09-B §6 | 08 W5、BM25 fixture | 通过 |
| golden 直出复验/bad case | 01 D-17；02 FR-05/10 | 04 §4.3；06 §4；09-A/09-B；11-A §5 | 08 W5/W7、A-05 | 通过 |
| 打标回流/防重复/内部不可见 | 01 D-17；02 FR-10 | 04 §4.3/8.1；06 outbox/IPC；09-B；10 §8 | 08 W7、A-07 | 通过；数据库约束缺口见 P1-009 |
| 可配置 Provider | 03 §5.1/5.2；10 §4/7.1 | 04/06/11-A/11-B | 08 W6 | 未闭环且互相冲突，见 P1-003 |
| DeepSeek Tool Call 边界 | 03 §5.4/5.6；11-A §4.2 | 06 §6 | 08 W6 | MVP 不调用一致；是否现在实现封装不一致，见 P2-002 |
| 浮窗 @昵称/置顶/10 秒/缩放 | 02 FR-06/07；10 §5 | 06 SourceComment/IPC；prototype | 08 W6/A-08 | @昵称、完整偏好和缩放验收缺口，见 P1-013 |
| 关闭到托盘/显式退出 | 02 FR-11 | 04 §8.2；10 §3；11-B §4.3 | 08 W1/A-08 | 通过 |
| 审计完整上下文/打标入口 | 02 FR-10 | 04 §8.1；06 IPC；10 §8 | 08 W7/A-07 | 设计通过；prototype 未覆盖状态，见 P1-012 |
| 永久本地保存且不导出 | 01 D-18；02 FR-10 | 04 §7；09-B §8；11-B §8.3 | 08 A-07/A-09 | 原则通过；容量/恢复边界验收不足，见 P2-008 |

## 3. 已通过的关键不变量

以下结论在有效文档的主线语义上一致，未发现反向设计：

- Windows 仅 x64、单直播间、单机 standalone、无独立云后端。
- 只有用户手动启动才创建 Echocue 到 douyinLive 的 WS；`ROOM_OFFLINE`、`ROOM_ENDED`、断连、停止均关闭 WS，不后台等待、不自动恢复、不排队。
- 浮窗展示期仍审计新弹幕，但以 `DISPLAY_WINDOW_ACTIVE` 丢弃，不检索、不生成、不补发；默认 10 秒且可配置。
- 实时主链路不用 Agent/多 Agent runtime，最多一次 LLM 主生成调用。
- 人设路由是确定性别名/高可信唯一匹配，歧义回退主要出镜人员；Qdrant 不参与人设路由。
- `pre_set` 与 `golden_set` 是两个 collection；前者通用、只读、不可直出，后者按 `persona_id + persona_version` 过滤。
- 文本链路固定为 regex/Unicode NFKC/受控词表/`jieba-wasm.cut_for_search`/MurmurHash3 x86 32-bit；文档侧 BM25 不预写 IDF，查询 token 值为 1，Qdrant `modifier: 'idf'`；两个 collection 共用冻结的 `avg_doc_len_baseline`。
- golden Top-1 只有通过版本、bad-case、阈值、结构、长度、安全、禁忌和新鲜度复验才直出；否则单次 LLM fallback。
- 拒绝无修正只标坏本次实际直出的 golden point；LLM/pre_set 路径不改写 pre_set；反馈用 transactional outbox 和幂等键防重复。
- 审计正文、人设、TopK、prompt、provider raw response 和状态迁移均进入本机加密 SQLite；Key/Cookie/Authorization 不进入审计/日志/遥测；审计不可写即停服。
- 关闭/Alt+F4 隐藏到托盘且服务继续；只有托盘显式退出才停服务、关 WS/sidecar/浮窗并退出。
- 审计页设计要求完整 workflow 上下文和打标入口，同时对用户隐藏 golden 同步、bad case、内部阈值和回流机制。

## 4. 发现清单

### 4.1 P0

#### EC-AUD-P0-001【确认缺陷/外部门禁】真实 douyinLive 普通弹幕 POC 没有交付证据

- 证据：旧审查明确写“尚未执行”（`docs/07-review/Echocue-文档体系审查报告-v0.1.md:8,26-30`）；root 仍声明 gate 未关闭（`docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md:61`）；当前有效文件清单不存在 POC 结果、30 分钟记录、SBOM/许可证复核或脱敏事件证据；交付计划把它定义为发布 P0（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:13,25,198`）。
- 冲突链/影响：M-01/D-02 要求真实普通弹幕 -> 技术选型依赖逆向第三方 -> 无真实 Windows x64 证据 -> 无法证明核心输入、生命周期、合规风险、稳定性和时延，完整 MVP 不可验收。
- 修正：按 08 A-01 和 03 POC-01 执行授权开播房间 30 分钟测试，归档版本/SHA/SBOM、事件数/评论数/重复率、状态与 WS close 时间、凭证落盘检查、异常复现；由甲方书面接受剩余条款/风控风险后关闭 gate。

### 4.2 P1

#### EC-AUD-P1-001【确认缺陷/治理】“开发基线”建立在未确认上游上，审批状态自相矛盾

- 证据：root 自称开发基线（`docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md:3`），但需求为“待甲方确认”（`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:6`）、PRD 为“待甲方评审”（`docs/02-product/Echocue-PRD-v0.1.md:6`）、调研为“待甲方确认调研结论与 POC 授权”（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:6`）、架构为“详细设计起稿”（`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:3`）、交付为“开发基线草案”（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:3`）；同时需求 D-01 至 D-20 又逐项标“已确认”（`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:178-208`）。
- 影响：无法判定“文档状态”还是“表内决策状态”具有法律/项目效力；后续按未签核范围开发会造成返工和验收争议。
- 修正：新增一次甲方签核记录，给 01/02/03 分别标明批准人、批准日期、决策版本和遗留 POC；root 只索引已批准基线，草案需显式标非规范性。

#### EC-AUD-P1-002【确认缺陷/root】索引漏产物、依赖顺序倒置且多处追溯 ID 错误

- 证据：root 文档地图只列 01–11 文档（`docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md:15-29`），未纳入其下游明确依赖的 `prototype/README.md`、prototype 源码/构建配置和两个规范性 SVG；推荐顺序把 09-A 放在 05/06 之前（同文件 `:48-53`），但 09-A 自己声明冲突时以 06 为准（`docs/09-design/Echocue-系统详细设计图册-v0.1.md:5`）。矩阵把 jieba-BM25 回链到实际为“审计/人设”的 D-15/D-16（root 同文件 `:38`），浮窗回链到不存在的 D-21 且 D-10 实为 MCN 演进（同文件 `:40` 对比 `docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:198-199`），审计回链到实际为 DeepSeek 配置的 D-14（root 同文件 `:41`），standalone 回链到安全 D-08（同文件 `:42`）。
- 影响：开发者按 root 查阅会先读到依赖未定义的图册，并把需求、任务和验收关联到错误决策；root 不能完成其“统一权威范围与交叉引用”职责。
- 修正：按本报告 §1.2 重排；补列 prototype/README、原型源与 SVG 资产；逐项改成真实 D/FR/W/A ID（如 BM25 D-13/D-17、浮窗 D-07/D-07a/D-11、审计 D-15/D-18、standalone D-03a/D-19），加入双向反查列和批准状态。

#### EC-AUD-P1-003【确认缺陷】Provider 上游要求可替换/UI 可配置，下游契约和部署却硬绑定 DeepSeek

- 证据：调研明确“不锁死单一供应商”、定义 `TextGenerationProvider` 且 DeepSeek 只是首个实现（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:309-315`）；UI 明确配置服务商名称、`base_url`、`model_id`、API Key，且“不预设或绑定 DeepSeek”（`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:127,169-171`），prototype 也给出四字段（`prototype/src/pages/ConfigPages.tsx:1`）。但架构主链直接指向 DeepSeek（`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:9,26`），Settings 只有 `modelId`、safeStorage 只定义 DeepSeek Key（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:12,15,243-251`），请求/审计接口无 provider/base URL/adapter ID（同文件 `:397-425`），协议固定 `DeepSeekProvider`（同文件 `:445`），部署前置也只接受 DeepSeek（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:41,67`）。
- 影响：Renderer 能收集的数据无法经 `config.update` 保存，业务/审计无法复现实际适配器和 endpoint；实现者只能删 UI 字段或硬编码 DeepSeek，两者都违背一侧基线。任意 Base URL 若无 HTTPS/凭证域校验还可能把 Key 发往错误主机。
- 修正：建立 `ProviderConfigV1 {providerId, displayName, adapterType, baseUrl, modelId, credentialRef}`；Key 按 provider 独立 safeStorage；`GenerateSuggestion*`/审计加入 provider/adapter/base URL 分类；明确 DeepSeek 为首个受支持 adapter，不把业务层绑定它；对 HTTPS、重定向、host 变更、连接测试和 Key 发送范围制定安全校验与 contract fixture。

#### EC-AUD-P1-004【确认缺陷】服务与 trace 状态机存在三套不可兼容契约，展示结果语义会被覆盖

- 证据：06 的合法 trace 状态/迁移要求 `RETRIEVING -> PROMPT_RENDERED -> LLM_PENDING`，输出校验失败落 `DISCARDED`，`DISPLAYED -> EXPIRED`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:29-39,211-223`）。09-A 却写 `RETRIEVING -> LLM_PENDING`、新增未定义 `REJECTED/HIDDEN`（`docs/09-design/Echocue-系统详细设计图册-v0.1.md:340-366`）。09-A 的“服务状态机”把 `RETRIEVING/GENERATING` 当 lifecycle（同文件 `:321-335`），而 06 把它们定义为 `activity`，lifecycle 仅四值（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:347-356`）；04 图还有未进入领域类型的 `STARTING`（`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:44-55,154-156`）。此外 06 的 `TraceFinalState` 不含 `DISPLAYED`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:37-39`），DDL `final_state` 却允许 `DISPLAYED`（同文件 `:94-105`），而 09-B 要求展示后最终变为 `EXPIRED`（`docs/09-design/Echocue-数据建模与迁移设计-v0.1.md:161`），会把“成功展示后自然隐藏”和“展示前因过期未展示”压成同一结果。
- 影响：按图册实现会被 `AuditStoreWorker` 判非法；按协议实现则 UI/审计筛选“已展示/已过期”无法可靠区分，FR-10 的“展示”和“过期丢弃”验收不可复核。
- 修正：只保留一份可生成代码的 `ServiceLifecycle`、`ServiceActivity`、`TraceState/Transition/FinalOutcome`；展示自然结束用 `DISPLAYED -> HIDDEN` 或把 `display_outcome` 与 workflow terminal 分列，绝不复用“未展示过期”；同步更新 03/04/06/09-A/09-B/10/08 图和 fixture。

#### EC-AUD-P1-005【风险/歧义】P95 3 秒的 t0/t_end 在上游、架构和验收中不一致

- 证据：需求成功标准写“目标弹幕发出到自动展示”（`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:69`），NFR/D-09 写“到达接入服务”到“client 完成浮窗展示”（同文件 `:160,197`）；调研把 t0 定为“收到并标准化”（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:107,385-396`）；架构从“适配器规范化完成”开始（`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:15`）；06 在适配器输出后才创建 `ProcessingComment` 并用其 t0（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:381-387,434`）；08 又写 t0“收到 WS”、终点 overlay 首帧（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:163-174`）。
- 影响：同一运行可因少算适配/规范化或把“完成展示”解释为 10 秒隐藏而得到不同 P95；A-06 无法形成唯一验收证据。
- 修正：统一 `t0=client 收到原始 WebSocket frame 的单调时钟`、`t_end=overlay first-frame acknowledgement`；规范化、选择、检索、模型、审计、首帧全部给中间点；上游 createTime 单独报告但不计 SLO；明确 5 秒是 provider 保险上限，attempt 仍应在 3 秒新鲜度 deadline 前取消；固化样本选择、预热、网络、样本数与失败样本统计规则。

#### EC-AUD-P1-006【确认缺陷】最高风险的自然语言禁忌/隐私过滤没有可实施契约

- 证据：PRD 要求基础风险、自然语言禁忌和关键词的组合“由技术设计定义”，且不确定风险宁可忽略（`docs/02-product/Echocue-PRD-v0.1.md:174-185`）；需求已把分类不可测试列为风险（`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:172-175`）。但 06 的设置仅保存一段 `forbiddenPolicyText` 与关键词（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:240-254`），没有规则版本结构、类别、match type、优先级、编译/解析失败状态和 reason code；W4 只写“实现隐私、辱骂、关键词、自定义规则”（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:79-90`）。11-A 的自然语言规则检查位于输出校验阶段（`docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md:228-236`），不能补足“模型调用前”对输入弹幕的规则解释。
- 影响：开发者无法从自然语言确定性地产生相同过滤结论；高风险内容可能先进入 Qdrant/LLM，或保守实现把几乎所有内容拒绝。A-03 的 100% 仅对少量样本成立，不能证明分类边界。
- 修正：补《安全规则执行契约》：版本化输入、Unicode/变体归一、关键词/短语/regex/PII detector/自然语言规则解释器的职责与顺序、fail-closed 条件、reason enum、编译失败门禁、审计快照、误杀/漏放测试集和最小召回指标；输入与输出复用同版本规则，但分别记录结论。

#### EC-AUD-P1-007【确认缺陷】首次初始化顺序要求在 collection 创建前导入 pre_set

- 证据：09-B 顺序为“启动 Qdrant -> 初始化 SQLite -> 导入 pre_set -> 创建两个 collection”（`docs/09-design/Echocue-数据建模与迁移设计-v0.1.md:295-301`）；11-B 流程图同样 `校验并导入 -> 计算基线 -> 创建 collection`（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:71-85`），正文又说导入后计算平均值（`:89`）。
- 影响：若“导入”按通常含义是 upsert，目标 collection 尚不存在；若只是解析/暂存，文档没有 staging 状态、失败恢复和原子发布语义。首次安装无法按文档实现为可重入事务。
- 修正：明确为“离线校验/分词并暂存 -> 计算 profile -> 创建临时 pre/golden collection 与 index/metadata -> 批量 upsert -> 数量/fixture 校验 -> 原子激活”；失败删除或隔离临时 collection，但不得触碰历史 active profile；在 06/09-B/11-B/08 统一。

#### EC-AUD-P1-008【确认缺陷】人设回滚为新版本被 DDL 的内容唯一约束禁止

- 证据：架构要求历史版本回滚时创建新的发布版本（`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:125`），UI 同样要求以历史版本创建新草稿再发布（`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:163-165`），W3 明确实现“回滚为新版本”（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:69-76`）。但 DDL 对 `(persona_id, content_hmac)` 建 UNIQUE（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:63-74`）；把 v1 原文作为新版本发布必然复用 HMAC 并冲突。
- 影响：核心版本回滚路径运行时失败，且无法产生“新的版本号/发布时间/来源”审计。
- 修正：移除内容 HMAC 唯一性，把 HMAC 仅作为完整性/去重提示；允许相同正文不同 version，使用 `created_from_version`/`rollback_from_version` 记录来源；补 exact-content rollback migration/测试。

#### EC-AUD-P1-009【确认缺陷】outbox 数据约束允许写入明令只读的 pre_set

- 证据：业务不变量规定 `pre_set` 运行期只读（`docs/09-design/Echocue-数据建模与迁移设计-v0.1.md:21-26`；`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:121-124`），但 `qdrant_sync_job.target_collection` CHECK 同时允许 `golden_set/pre_set`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:155-166`），09-B 甚至明确承认 schema 允许但 MVP 实际只准 golden（`docs/09-design/Echocue-数据建模与迁移设计-v0.1.md:177-182`）。
- 影响：错误或越权 job 在数据库层合法，worker 若漏校验即可 UPSERT/SET_BAD_CASE pre_set，破坏 D-17、bad-case 边界和审计可解释性。
- 修正：MVP migration 直接 CHECK `target_collection='golden_set'`，并对 `UPSERT/SET_BAD_CASE` 与 feedback source/target 条件加 trigger/worker 双重校验；若未来需要 profile 迁移，使用独立受控 job 类型/表，不复用用户反馈 outbox。

#### EC-AUD-P1-010【确认缺陷】IPC 与错误码没有唯一契约，图册调用不存在的方法

- 证据：06 IPC 规定 `audit.getWorkflow`、`audit.submitLabel`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:453-466`），09-A 时序却调用 `audit.getTrace`、`feedback.submit`（`docs/09-design/Echocue-系统详细设计图册-v0.1.md:293-300`）。06 错误表使用 `E_CONFIG_MISSING/E_ROOM_OFFLINE/E_LLM_TIMEOUT/E_LLM_PROVIDER/E_GOLDEN_SYNC`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:470-481`），11-B 改成 `E_CONFIG_INVALID/E_LIVE_OFFLINE/E_PROVIDER_*` 并增加多码（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:159-175`）；11-A Provider error 还含 NETWORK/PROTOCOL/OUTPUT_INVALID（`docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md:37-40`）。
- 影响：Renderer、Main、诊断、测试 fixture 会各自实现不同名字；08 要求“覆盖所有错误码”（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:143-146`）却没有可枚举的全集。
- 修正：生成一个版本化 IPC/error/reason schema；06 为唯一事实源，图册只引用；明确 provider raw error -> domain error -> user message 三层映射，并为每码规定服务动作、审计状态和可恢复性。

#### EC-AUD-P1-011【风险/歧义】Windows standalone 包内 douyinLive 的责任和退出生命周期未冻结

- 证据：调研架构称本地适配器随 client 安装并由 client 管理（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:22-32`）；11-B 又说安装包“必须包含”固定版本产物（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:23-31`），同一表把 douyinLive 写成“已安装或甲方受控启动”（同文件 `:32`），随后把随包 sidecar/外部维护留到发布前 POC 决定（同文件 `:35`）。显式退出统一要求关闭 sidecar（同文件 `:106-115`），但外部维护模式不应由 Echocue 杀掉共享进程。
- 影响：安装包清单、哈希/SBOM、端口占用、进程所有权、升级、退出清理和 A-09 均无法编写唯一实现。
- 修正：在 POC 前选定一个 MVP mode。推荐随包受控 sidecar，定义 executable/tag/SHA/license、端口分配、工作目录、父子进程/Job Object 和退出顺序；若保留 external mode，显式区分“只关 Echocue WS”与“关外部服务”，并分别验收。

#### EC-AUD-P1-012【确认缺陷/prototype】原型虽可类型检查，但不覆盖 UI 契约要求的交互状态

- 证据：README 称其为静态交互原型并覆盖所有入口（`prototype/README.md:1-3,14-18`），实际 `App.tsx` 三个窗口按钮无 tooltip、可访问名或行为，且把“直播浮窗（原型）”放入主导航（`prototype/src/App.tsx:1-3`）。所有关键页面多为单行静态 JSX：运行页只有 RUNNING（`prototype/src/pages/RunPage.tsx:1`）；偏好缺字号/主题/click-through 控件、恢复默认和保存，安全关键词不可增删（`prototype/src/pages/ConfigPages.tsx:1-5`）；人设缺新增/删除/主出镜切换/预览/比较（`prototype/src/pages/PersonaPage.tsx:1`）；审计列表不可选/分页，workflow 无原文、时间戳、TopK/LLM 证据，打标无修正分数/修订状态（`prototype/src/pages/AuditPage.tsx:1-4`）。这些状态在 UI 契约中是强要求（`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:64-68,115-127,137-146,163-165,185-222`）。
- 影响：原型不能用于验证错误/空/加载/停止/未开播/展示期/已打标等开发状态，README 的“可继续复用”会把 mock 缺口带入 Renderer。
- 修正：增加可切换状态 fixture 和真正的本地交互；覆盖 UI §9 状态矩阵、窗口按钮语义、配置保存/校验、浮窗全部偏好、persona 版本流程、审计记录选择/分页/两个详情入口/打标修订；主导航移除 overlay 或显式置于开发专用区域。

#### EC-AUD-P1-013【确认缺陷/追溯】多项明确 UI/隐私需求未落到任务与验收

- 证据：FR-07 要拖拽、尺寸、透明度、字号、主题、点击穿透和持久化（`docs/02-product/Echocue-PRD-v0.1.md:214-226`），UI 还要求 `@昵称`、跨屏安全位置、最小尺寸（`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:129-146`）；W6/A-08 只验置顶、10 秒和尺寸（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:109-123,205`）。可配置 provider 没有对应 W/A（对比 UI 同文件 `:127,169-171` 与 08 W6）；永久不导出、用户不可见回流机制、审计访问提示也未在 A-07/A-09 中形成明确反向用例（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:202-207`）。
- 影响：功能可按现有 A-08/A-09 判通过，却缺 @昵称、字号/透明度/主题/click-through/拖拽、provider 四字段、无导出入口和内部机制不可见等甲方明确要求。
- 修正：逐 FR/D 建立原子测试 ID；扩充 W1/W6/W7 与 A-07/A-08/A-09，至少包含 `@userNickname` 有/无值、偏好重启持久化/跨屏恢复、所有浮窗控件、provider 四字段与 Key 不回显、审计无导出/无清空、打标页不出现 golden/bad-case/sync/threshold。

### 4.3 P2

#### EC-AUD-P2-001【确认缺陷】调研对 pre_set payload 的描述与最终数据契约冲突

- 证据：调研称“两库 point 均含 persona_id、persona_version”（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:255`），但同文后续又说 pre_set 通用且不按人设过滤（同文件 `:291-295`），06 `PreSetPayload` 无 persona 字段（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:272-290`）。
- 影响：按调研开发 importer 会错误要求甲方为通用案例绑定人设，或产生无意义字段。
- 修正：调研改为“共同字段仅 case/text/type/enabled/bad_case/profile；persona/version 仅 golden”。

#### EC-AUD-P2-002【风险/范围】MVP 明确不调用 Tool Calls，但 W6 又要求当前实现特殊封装

- 证据：调研明确 MVP 不调用 Tool Calls（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:374-379`），LLM 设计把 adapter 放在“未来确有需求时”并规定当前请求不得含 tools（`docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md:180-197`）；W6 却把“特殊 tool-call 封装”列为 MVP 实现（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:113-116`）。
- 影响：DoD 不清楚：团队可能为未使用 Beta 协议投入开发/测试，或因没实现而被误判未完成。
- 修正：W6 只要求“响应出现 tool_calls 按 PROTOCOL 失败”的 fixture；完整 `DeepSeekToolCallAdapter` 移到后续 backlog。若甲方坚持预留，标为非阻断独立任务且不得接入 MVP 运行路径。

#### EC-AUD-P2-003【风险/契约】若干“只能为枚举”的字段在 schema 中仍是任意字符串

- 证据：05 定义七个 `semantic_type`（`docs/05-data-interface/Echocue-pre_set初始案例数据标准-v0.1.md:44-56`），06 的 `PreSetPayload/GoldenSetPayload` 却都写 `semantic_type: string`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:275-287,295-310`）；06 又说 snapshot `content_type/role` 只能取表中值（同文件 `:225-236`），但 DDL 两列只是无 CHECK 的 TEXT（同文件 `:119-133`）。
- 影响：未知 semantic type 无法按 4.3 分类；任意 role/content_type 会让回放缺证据但仍通过数据库写入。
- 修正：定义 `SemanticTypeV1`、`AuditSnapshotRoleV1`、`AuditContentTypeV1`，在 JSON Schema/Zod/TypeScript/SQLite CHECK 同步生成；扩展必须升 schema/profile 版本。

#### EC-AUD-P2-004【确认缺陷/Markdown】UI 表格分隔行少一列

- 证据：`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:88` 是四列表头，`:89` 只有三个分隔单元；自动列数检查唯一报错即该块。
- 影响：部分 Markdown renderer 会错列或不识别表格，影响错误反馈规范阅读。
- 修正：将第 89 行改为四个 `---` 单元，并在 CI 加 markdownlint/表格列数检查。

#### EC-AUD-P2-005【确认缺陷/链接】root 的“文档地图”不是可用链接，多个相对代码路径基准不明确

- 证据：root `docs/00-index/Echocue-开发文档总览与可追溯矩阵-v0.1.md:17-29` 把文档写成 code span，且内容如 `01-requirements/...` 若按当前文件目录解析会落到不存在的 `docs/00-index/01-requirements`；实际全库只有一个本地 Markdown 链接，即 UI 到 prototype（`docs/10-ui/Echocue-UI信息架构与交互设计-v0.1.md:10`，已验证存在）。UI 同文件 `:66,115,133,163,175,189` 的 `prototype/src/...` 及多文档 `svg/...` 也未声明“仓库根目录相对”。
- 影响：root 无法点击导航；文档移动/站点生成时路径失效，代码审查工具不能验证引用。
- 修正：全部改为真实相对 Markdown 链接（root 用 `../01-requirements/...`，各 docs 到 prototype/svg 用 `../../prototype/...`、`../../svg/...`），章节引用改为稳定锚点或唯一需求 ID。

#### EC-AUD-P2-006【确认缺陷/术语】模型输出字段在调研仍使用 `cue[]`，正式契约使用 `cues`

- 证据：调研在 DeepSeek 能力和调用规则中使用 `cue[]`（`docs/03-research/Echocue-技术调研与选型报告-v0.1.md:339,365-378`），06/11-A JSON 使用 `cues`（`docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md:436-447`；`docs/11-implementation/Echocue-LLM提示词与输出校验设计-v0.1.md:205-221`）。
- 影响：fixture/adapter 实现者可能生成错误字段并被本地 schema 拒绝。
- 修正：全局统一 `cues`；文案层仍称“提词”。

#### EC-AUD-P2-007【风险】pre_set “Schema”缺少可执行严格度和输入上限

- 证据：05 只有示例和 prose 表（`docs/05-data-interface/Echocue-pre_set初始案例数据标准-v0.1.md:14-42`），`semantic_type` 还写“建议优先使用”（同文件 `:44-47`）；部署却要求拒绝未知 schema/无效字段/敏感内容（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:65-69`）。没有规定额外字段策略、id/text/description/reply/tags 的长度/数量、总文件/行上限、重复更新与首次导入的冲突策略。
- 影响：甲方 JSONL 可在不同 importer 上得到不同结果；极端文本/数组可能拖垮分词、审计或 prompt。
- 修正：交付 JSON Schema + Zod；`additionalProperties:false`；枚举、长度、数组和文件规模上限；逐行错误报告；全文件验证成功后才发布 collection；提供 valid/invalid fixture。

#### EC-AUD-P2-008【风险/运维】“永久保存”只有停服策略，没有容量预警与可验收的恢复容量边界

- 证据：需求要求永久保存且不可写即停服（`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:206`），部署只要求预留增长空间（`docs/11-implementation/Echocue-Windows部署运行与故障处理手册-v0.1.md:37-42`）并在满盘后停服（同文件 `:132-146`），MVP 又无清空/导出（同文件 `:16-18,190-194`）；A-07/A-09 未定义低磁盘预警、增长估算或满盘恢复演练（`docs/08-delivery/Echocue-研发任务拆分、测试计划与验收标准-v0.1.md:202-207`）。
- 影响：长期运行必然增长，用户可能在开播时突然停服且无提前处置窗口；恢复流程的可操作性不可验收。
- 修正：定义每千条估算、启动/运行期磁盘阈值、只显示容量而不泄露原文的预警、WAL checkpoint/恢复演练和受控本机备份责任；不通过自动删除来规避永久保存。

### 4.4 P3

#### EC-AUD-P3-001【建议优化】需求 D-06 的箭头顺序容易被读成“先筛选后安全”

- 证据：`docs/01-requirements/Echocue-需求澄清与MVP定义-v0.1.md:191` 写“目标弹幕筛选 -> 风险过滤 -> 回复”，而同文件流程 `:103-106` 与所有下游均是硬风险过滤优先。
- 建议：改为“硬风险过滤 -> 安全候选价值筛选/路由 -> 回复”，避免开发者按错误顺序实现。

#### EC-AUD-P3-002【建议优化】托盘 SVG 的可访问标题称为 taskbar icon

- 证据：`svg/douyin-echocue-client-tray-icon.svg:2-3` 的 title/desc 写 taskbar，而 PRD/架构指定它为 tray icon（`docs/02-product/Echocue-PRD-v0.1.md:279`；`docs/04-architecture/Echocue-系统架构与详细设计说明书-v0.1.md:256-263`）。
- 建议：只修正 SVG 元数据文本，不改变图形设计。

## 5. 缺失材料

1. 甲方签核的 01/02/03 基线及每个“已确认”决策的来源/日期。
2. douyinLive Windows x64 POC 报告、原始脱敏计数、版本/SHA/SBOM/许可证复核和风险接受记录。
3. Qdrant/jieba/hash/calibration POC 产物：跨语言 token fixture、中文检索基准、阈值 artifact、profile metadata 示例。
4. 可生成代码的 canonical service/trace/feedback/outbox 状态与 reason/error enum。
5. Provider 配置/凭证/adapter contract 与至少 DeepSeek + 一个替代兼容 adapter 的 contract fixture。
6. 输入/输出安全规则执行契约、分类/PII/自然语言禁忌测试集和准确性报告。
7. 实际 migration 文件、严格 pre_set JSON Schema、IPC Zod schema、审计 snapshot schema；当前只有文档片段。
8. Windows 安装包 manifest、版本兼容矩阵、二进制哈希和进程所有权/退出策略。
9. 可切换完整 UI 状态的 prototype 及页面级验收脚本。
10. 全量 D/FR -> 设计 -> schema/API -> W -> testcase -> A 的机器可读追溯表；当前 root 只覆盖主题级且存在错链。

## 6. 自动检查与未验证项

### 6.1 已执行结果

| 检查 | 结果 |
| --- | --- |
| 文件盘点/行数/标题 | 14 个 docs Markdown、prototype 非依赖文件、2 个 SVG 均已盘点 |
| Mermaid fence | 29 个；围栏均闭合，首指令均为 flowchart/stateDiagram/sequenceDiagram/erDiagram；人工结构检查发现的是 P1-004 语义契约冲突，不是 fence 破损 |
| Markdown fence | 全部成对闭合 |
| 表格列数 | 发现 1 处确定错误：UI 第 88–89 行 |
| 本地 Markdown 链接 | 唯一真实本地链接 `../../prototype/README.md` 存在；root 地图为 code span，不可导航 |
| SQL | 用 Node 24 `node:sqlite` 内存库执行 06 的两个 SQL block，均 `OK` |
| SVG | 两个 SVG 均为可解析 XML，viewBox 分别为 `0 0 512 512`、`0 0 24 24` |
| TypeScript | `tsc -p tsconfig.json --noEmit --incremental false` 通过，退出码 0 |
| Vite 构建 | 未完成：现有 `node_modules` 只有 Linux Rollup 原生包，缺 `@rollup/rollup-win32-x64-msvc`；未联网安装 |

### 6.2 实际命令（等价摘要）

```powershell
rg --files docs
rg --files prototype -g '!prototype/node_modules/**' -g '!prototype/dist/**'
rg -n '^#{1,6} ' docs prototype/README.md
# PowerShell：逐文件行数、Mermaid/通用 fence、表格列数、本地 Markdown 链接、SVG XML 解析
node -e "... DatabaseSync(':memory:') ... exec(sqlBlocks) ..."
node prototype/node_modules/typescript/bin/tsc -p prototype/tsconfig.json --noEmit --incremental false
npm run build
pnpm run build
node prototype/node_modules/vite/bin/vite.js build
```

### 6.3 未验证项与原因

- 未做 Mermaid renderer/parser 级渲染：工作区无 `mmdc`/Mermaid 依赖，遵守不联网安装；完成了 fence、首指令和人工结构检查。状态图虽可能被 Mermaid 接受，P1-004 的领域语义仍会阻断实现。
- 未完成 Vite bundle：`npm` 不在 PATH；pnpm 自检尝试写临时文件时报 EPERM；直接 Vite 因 Windows Rollup 可选包缺失失败。package-lock 包含该包声明，但当前 `node_modules/@rollup` 实际只有 `rollup-linux-x64-gnu`。TypeScript 已独立通过。
- 未验证 Electron Windows x64 打包、always-on-top、click-through、托盘、ICO/PNG 转换、DPAPI、Qdrant/douyinLive sidecar：仓库没有 Electron 应用或安装包，prototype 明确只有浏览器 mock。
- 未访问 Figma 链接、未逐一刷新外部技术资料的当前内容/HTTP 状态；本报告的缺陷判断只依赖仓库内自述和相互契约，不把外部网页作为结论来源。
- 未执行真实 POC、模型调用、Qdrant 检索、加密/恢复和性能测试：所需二进制、账户、真实房间、样本与实现均未交付。

## 7. 进入开发前门禁结论

结论为 **NO-GO（针对全量开发、接口冻结、真实联调与 MVP 验收）**。

必须先关闭：

1. EC-AUD-P0-001：真实 douyinLive POC 与风险接受；
2. EC-AUD-P1-001：甲方批准并冻结规范性基线；
3. EC-AUD-P1-003/P1-004/P1-005/P1-006：Provider、状态机、时延和安全四个核心契约；
4. EC-AUD-P1-007/P1-008/P1-009/P1-010/P1-011：初始化、版本回滚、outbox、IPC/error、sidecar 打包；
5. 修正 root 追溯并将缺漏需求落实到任务/验收，再以更新后的 prototype 做 UI 状态复核。

可在不扩大承诺的前提下继续：Electron/Vite/React 基座、无业务字段的窗口壳、纯内存状态机原型、SQLite/Qdrant/jieba 独立 POC、测试框架与 CI。不得在冲突关闭前冻结数据库 migration、Renderer IPC、Provider 配置、审计状态/错误码或安装包 sidecar 生命周期，也不得声称“文档已无 P0/P1”或“可交付 MVP”。
