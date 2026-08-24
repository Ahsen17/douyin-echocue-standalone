# Echocue 系统详细设计图册 v0.1

> 状态：详细设计补充交付  
> 范围：Windows x64 standalone MVP，单直播间、单团队、人工查看建议  
> 读取顺序：本图册将既有需求、产品、技术选型、架构和数据接口内容重新组织为可渲染图；不替代其字段、接口和验收细节。若有冲突，以《需求澄清与 MVP 定义》《PRD》和《数据模型、接口与实时事件协议》的已确认决策为准。

## 1. 图册边界与关键不变量

1. 只给出建议，绝不自动向抖音发送回复。
2. `douyinLive` 本地 WS 由用户手动启动触发；只有 `ROOM_ONLINE` 才能开始服务。未开播、下播、断开、用户停止或审计不可写时立即关 WS，不自动重连。
3. 每次浮窗展示一条建议，默认 10 秒且可配置。展示期仍审计新弹幕，但不检索、不生成、不排队；到期仅从最新窗口重新选择。
4. 检索是两路并行的 `pre_set` 与 `golden_set`。`golden_set` 必须按当前人设版本、启用状态和 bad case 过滤；高置信 golden payload 仍须通过当前安全、人设、结构和长度复验，才可直出。
5. 稀疏检索固定为：regex 清理 → Unicode NFKC → `jieba-wasm.cut_for_search` → FastEmbed 兼容 MurmurHash3 token ID → BM25 文档侧权重；查询 token 权重为 1，由 Qdrant `modifier: IDF` 动态施加 IDF。`avg_doc_len_baseline` 从完整 `pre_set` 首次导入测得后冻结。
6. 每条弹幕都必须有 `trace_id`。审计库首次写入失败时，取消当前 attempt、隐藏未展示建议并停止服务；审计原文永久本机保存且不进入普通日志或遥测。

## 2. 系统上下文与组件边界

```mermaid
flowchart LR
  Streamer[出镜人员]
  Configurer[配置人员]
  Douyin[抖音直播间]
  DYL[douyinLive 本地服务]
  DS[TextGenerationProvider API\nDeepSeek 首个适配器]

  subgraph Client[Windows Echocue standalone client]
    direction LR
    Main[Electron Main\nService Orchestrator]
    UI[React 主窗口 Renderer\n运行 配置 审计]
    Overlay[Overlay Renderer\n置顶建议浮窗]
    Worker[AuditStore Worker]
    SQLite[(加密 SQLite\n审计 人设版本 反馈 outbox)]
    Qdrant[Qdrant Sidecar\n127.0.0.1]
    Config[本机配置与 safeStorage\nAPI Key 浮窗偏好 禁忌]
    Metrics[Prometheus OTel\n匿名指标]
  end

  Streamer -->|查看建议 自主口播| Overlay
  Configurer -->|配置 启停 审计 打标| UI
  UI <-->|preload 白名单 IPC| Main
  Main -->|受限展示 IPC| Overlay
  Main <--> Worker
  Worker <--> SQLite
  Main <--> Config
  Main <-->|localhost WS 仅运行期| DYL
  DYL <-->|非官方上游连接| Douyin
  Main <-->|localhost HTTP| Qdrant
  Main -->|单次 LLM 调用| DS
  Main -->|无原文 无 trace_id| Metrics
```

### 2.1 进程和数据访问责任

| 单元 | 负责 | 不可负责 |
| --- | --- | --- |
| 主窗口 Renderer | UI、配置编辑、受控审计查看和打标入口 | Node、文件、网络、SQLite、Qdrant、密钥 |
| 浮窗 Renderer | 已校验建议和视觉偏好 | 检索、生成、审计、配置写入 |
| Electron Main | 生命周期、WS、候选编排、检索、LLM、窗口和 IPC 授权 | 向 Renderer 广播密钥或审计快照 |
| AuditStore Worker | SQLite 事务、字段加密、审计状态、反馈和 outbox | 网络、UI、任何 Provider Key |
| Qdrant Sidecar | 两 collection 的本机稀疏检索 | 审计事实、用户可见反馈状态 |

## 3. 服务启动门禁与停止流程

```mermaid
flowchart TD
  A[用户点击启动] --> B{必要配置完整\n直播间 主出镜 已发布人设 API Key}
  B -- 否 --> B1[保持 STOPPED\n提示完成配置]
  B -- 是 --> C[校验审计库可写\n启动或校验 Qdrant sidecar]
  C --> D{基础设施可用}
  D -- 否 --> D1[保持 STOPPED\n提示修复后手动重试]
  D -- 是 --> E[创建 douyinLive localhost WS]
  E --> F{收到 live_status}
  F -- ROOM_ONLINE --> G[创建 session_id\n冻结本场人设版本快照]
  G --> H[RUNNING 监听弹幕]
  F -- ROOM_OFFLINE --> I[立即关闭 WS]
  F -- ROOM_ENDED --> I
  F -- 超时或连接异常 --> I
  I --> J[STOPPED\n可由用户手动再次启动]
  H --> K{STOP ROOM_ENDED\nWS 断开 审计失败}
  K -- 是 --> L[取消 in-flight\n隐藏浮窗 清空窗口 关闭 WS]
  L --> J
  H --> M[用户停止]
  M --> L
```

**门禁规则**：`ROOM_OFFLINE` / `ROOM_ENDED` 后不保持 WS 等待下次开播；不会自动恢复、后台轮询或弹出恢复提醒。用户必须再次点击启动，重新创建 WS 并等待新的 `ROOM_ONLINE`。

## 4. 实时建议完整功能流程

```mermaid
flowchart TD
  C0[WebcastChatMessage 到达] --> C1[创建 trace_id\n审计 RECEIVED 和原始事件]
  C1 --> C2[规范化和会话内 source_message_id 去重]
  C2 --> C3{activity 为 DISPLAYING}
  C3 -- 是 --> C4[审计 NORMALIZED 到 DISCARDED\nreason DISPLAY_WINDOW_ACTIVE]
  C4 --> C5[不检索 不生成 不入队]
  C3 -- 否 --> C6{重复或硬规则命中\n风险 隐私 侮辱 禁忌}
  C6 -- 是 --> C7[审计 FILTERED 或 DISCARDED\n不生成]
  C6 -- 否 --> C8[加入最新滚动窗口\n仅保留 window_max_age 内候选]
  C8 --> C9{当前最高优先级\n且仍未过期}
  C9 -- 否 --> C10[审计丢弃或等待最新窗口重选]
  C9 -- 是 --> C11[唯一 SuggestionAttempt\n绑定 session trace window AbortController]
  C11 --> C12[确定性成员别名路由\n歧义回退主出镜]
  C12 --> C13[审计 ROUTED 和人设版本快照]
  C13 --> C14a[异步读取已冻结的人设快照]
  C13 --> C14b[并行双路 BM25 检索]
  C14a --> C15[合并上下文]
  C14b --> C15
  C15 --> C16[归一化并 rerank TopK\n审计原始分数和校准值]
  C16 --> C17{Top1 为 golden_set\n直出阈值通过}
  C17 -- 是 --> C18[复验当前人设 禁忌 安全\n结构 长度 新鲜度]
  C18 --> C19{复验通过}
  C19 -- 是 --> C20[DIRECT_READY\n不调用 LLM]
  C19 -- 否 --> C21[渲染提示词]
  C17 -- 否 --> C21
  C21 --> C22[调用一次选定 Provider\n10 秒保险上限且服从新鲜度 deadline]
  C22 --> C23{输出校验通过\n且 attempt 仍有效}
  C23 -- 否 --> C24[审计失败或 STALE\n回 RUNNING]
  C23 -- 是 --> C25[GENERATED DISPLAY_READY]
  C20 --> C26[显示始终置顶浮窗\n启动展示窗口]
  C25 --> C26
  C26 --> C27[审计 DISPLAYED 和首帧时间]
  C27 --> C28[DISPLAYING\n不生成 不排队]
  C28 --> C29{展示时长到期}
  C29 -- 是 --> C30[隐藏浮窗 清空旧候选\nwindow_version 加一]
  C30 --> C31[审计 HIDDEN\nactivity 回 LISTENING]
```

## 5. jieba-BM25 写入和查询数据流

```mermaid
flowchart LR
  subgraph Ingest[案例写入 pre_set 或 golden_set]
    I1[案例原文] --> I2[regex 清理无关符号]
    I2 --> I3[Unicode NFKC]
    I3 --> I4[jieba cut_for_search\n含团队自定义词典]
    I4 --> I5[MurmurHash3 x86 32\nUTF-8 seed 0 形成 token_id]
    I5 --> I6[统计 TF 和 doc_len\n使用冻结 avg_doc_len_baseline]
    I6 --> I7[BM25 文档侧权重\n不写入 IDF]
    I7 --> I8[Qdrant sparse vector upsert\nvalues 为文档权重]
  end

  subgraph Query[实时弹幕查询]
    Q1[规范化弹幕] --> Q2[regex 清理无关符号]
    Q2 --> Q3[Unicode NFKC]
    Q3 --> Q4[jieba cut_for_search\n同一词典版本]
    Q4 --> Q5[同一 MurmurHash3 token_id\n去重 token]
    Q5 --> Q6[query values 全部为 1]
    Q6 --> Q7[并行 pre_set golden_set\npayload filter]
  end

  I8 --> Store[(Qdrant collections)]
  Q7 --> Store
  Store --> R[modifier IDF 按 collection\n动态维护 IDF 并评分]
  R --> S[collection 内 raw score]
  S --> T[版本化 score calibration\n归一化和统一 rerank TopK]
```

`avg_doc_len_baseline` 只在完整 `pre_set` 初始导入完成后计算并冻结；两库共享该基线。golden 打标回流仅新增 point，不改写历史向量、不因单条反馈重建 collection。只有 jieba 词典、hash、`k1`、`b` 或平均长度基线等 retrieval profile 改变，才创建版本化 collection、离线重编码并原子切换。

## 6. 数据流图 DFD

```mermaid
flowchart LR
  Actor1[配置人员]
  Actor2[出镜人员]
  Source[douyinLive WS]
  Provider[TextGenerationProvider API]

  P1((P1 服务门禁与接入))
  P2((P2 筛选 路由 检索 生成))
  P3((P3 浮窗展示))
  P4((P4 审计追溯与打标))
  P5((P5 golden 回流同步))

  D1[(D1 本机配置\n禁忌 偏好 model_id)]
  D2[(D2 人设版本\nSQLite)]
  D3[(D3 审计和反馈\n加密 SQLite)]
  D4[(D4 pre_set\nQdrant)]
  D5[(D5 golden_set\nQdrant)]
  D6[(D6 safeStorage\nAPI Key)]

  Actor1 -->|配置 启停| P1
  Actor1 -->|人设发布| D2
  Source -->|live_status 和弹幕事件| P1
  P1 -->|合格会话和规范化弹幕| P2
  P1 <--> D1
  P2 -->|人设读取| D2
  P2 -->|BM25 查询| D4
  P2 -->|BM25 查询和版本 filter| D5
  P2 -->|API Key| D6
  P2 -->|单次 prompt 请求| Provider
  Provider -->|结构化建议或错误| P2
  P2 -->|每步快照和状态| D3
  P2 -->|已校验的一条建议| P3
  P3 -->|目标弹幕 回复 提词| Actor2
  P3 -->|显示 隐藏 首帧| D3
  Actor1 -->|查看 workflow 打标 修正| P4
  P4 <--> D3
  P4 -->|反馈事件| P5
  P5 -->|outbox 状态| D3
  P5 -->|合格答案 upsert\n或 golden bad case 标记| D5
```

数据边界：D3 是审计事实来源；D4/D5 是可重建的检索索引，不替代审计。D6 的 API Key 仅 Electron Main 可解密。Prometheus / OTel 只接收匿名耗时与枚举计数，故意不画入原文数据流。

## 7. 关键时序图

### 7.1 手动启动与开播门禁

```mermaid
sequenceDiagram
  actor U as 配置人员
  participant UI as 主窗口
  participant M as Main Orchestrator
  participant A as Audit Worker
  participant Q as Qdrant Sidecar
  participant W as douyinLive WS

  U->>UI: 点击启动
  UI->>M: service.start
  M->>M: 校验配置和已发布人设
  M->>A: healthcheck 可写
  A-->>M: ok
  M->>Q: healthcheck 初始化完成
  Q-->>M: ok
  M->>W: 创建 localhost WS
  alt ROOM_ONLINE
    W-->>M: live_status ROOM_ONLINE
    M->>A: 创建 session 和人设版本快照
    M-->>UI: RUNNING LISTENING
  else ROOM_OFFLINE ROOM_ENDED 超时或错误
    W-->>M: live_status 或 error
    M->>W: close
    M-->>UI: STOPPED 可手动重试
  end
```

### 7.2 建议生成、golden 直出与 LLM 兜底

```mermaid
sequenceDiagram
  participant W as douyinLive WS
  participant M as Main Orchestrator
  participant A as Audit Worker
  participant P as Persona Store
  participant Q as Qdrant
  participant D as TextGenerationProvider
  participant O as Overlay

  W->>M: WebcastChatMessage
  M->>A: RECEIVED NORMALIZED 规则结论
  alt activity 为 DISPLAYING
    M->>A: DISCARDED DISPLAY_WINDOW_ACTIVE
  else 风险或重复
    M->>A: FILTERED 或 DISCARDED
  else 安全且为最新候选
    par 人设与检索并行
      M->>P: 读取本场冻结 persona_version
      P-->>M: 人设快照和路由证据
    and
      M->>Q: pre_set BM25 query
      M->>Q: golden_set BM25 query 加 payload filter
      Q-->>M: 两路 raw hits
    end
    M->>A: ROUTED RETRIEVING TopK 校准证据
    alt 合格 golden Top1 可直出
      M->>M: 当前规则 人设 结构 长度 新鲜度复验
      M->>A: DIRECT_READY
      M->>O: 展示 reply 和 cues
    else 其余路径
      M->>D: 单次结构化生成请求
      D-->>M: response 或 error
      M->>M: 解析和共用输出校验
      M->>A: GENERATED 或 FAILED
      M->>O: 展示已校验建议
    end
    O-->>M: overlay first-frame
    M->>A: DISPLAYED
    M->>O: 展示窗口到期后隐藏
    M->>A: HIDDEN
  end
```

### 7.3 审计打标与 golden 增量回流

```mermaid
sequenceDiagram
  actor U as 被授权人员
  participant UI as 审计工作区
  participant M as Main IPC
  participant A as Audit Worker
  participant Q as golden_set

  U->>UI: 打开 workflow 上下文
  UI->>M: audit.getWorkflow trace_id
  M->>A: 解密读取受权快照
  A-->>M: 状态链 路由 检索 LLM 展示证据
  M-->>UI: 完整上下文
  U->>UI: 认可 拒绝 或修正并评分
  UI->>M: audit.submitLabel
  M->>A: 单事务写反馈 修订和 outbox
  alt 修正答案 或 未修正评分大于等于 85
    A-->>M: outbox PENDING
    M->>Q: 幂等 upsert golden point
    Q-->>M: point_id
    M->>A: outbox SYNCED 和 point_id
  else golden 直出被拒绝且无修正
    M->>Q: 标记该 point is_bad_case true
    M->>A: 写回同步结果
  else 低分或 pre_set LLM 拒绝
    M->>A: 保留反馈 不写案例库
  end
  M-->>UI: 可理解 label_status
```

## 8. 状态机图

### 8.1 服务状态机

```mermaid
stateDiagram-v2
  [*] --> STOPPED
  STOPPED --> GATE_CONNECTING: 用户 START
  GATE_CONNECTING --> RUNNING: ROOM_ONLINE 和审计可写
  GATE_CONNECTING --> STOPPED: ROOM_OFFLINE ROOM_ENDED 超时 连接失败
  RUNNING --> STOPPED: STOP ROOM_ENDED WS断开 审计失败
```

生命周期只有 `STOPPED/GATE_CONNECTING/RUNNING`。`RUNNING` 内另有唯一活动状态机：

```mermaid
stateDiagram-v2
  [*] --> LISTENING
  LISTENING --> RETRIEVING: 最新安全候选
  RETRIEVING --> GENERATING: 不满足直出
  RETRIEVING --> DISPLAYING: 直出复验和首帧通过
  RETRIEVING --> LISTENING: 丢弃 取消 检索失败
  GENERATING --> DISPLAYING: 输出校验和首帧通过
  GENERATING --> LISTENING: 超时 失败 丢弃 取消
  DISPLAYING --> LISTENING: 展示到期并审计 HIDDEN
```

activity=`DISPLAYING` 时不创建新的 `SuggestionAttempt`；展示期间收到的新弹幕只走可审计丢弃分支。

### 8.2 单条弹幕 workflow 状态机

```mermaid
stateDiagram-v2
  [*] --> RECEIVED
  RECEIVED --> NORMALIZED
  NORMALIZED --> DISCARDED: 重复 DISPLAY_WINDOW_ACTIVE 过期 取消
  NORMALIZED --> FILTERED: 硬规则命中
  NORMALIZED --> ROUTED: 安全候选被选中
  ROUTED --> RETRIEVING
  RETRIEVING --> DIRECT_READY: 合格 golden payload
  RETRIEVING --> PROMPT_RENDERED: 其余路径并完成 prompt
  RETRIEVING --> DISCARDED: 失效 取消 检索异常
  DIRECT_READY --> DISPLAY_READY: 共用输出校验通过
  DIRECT_READY --> DISCARDED: 共用输出校验失败
  PROMPT_RENDERED --> LLM_PENDING: 发起唯一 Provider 请求
  LLM_PENDING --> GENERATED: 结构化输出成功
  LLM_PENDING --> FAILED: 超时 Provider 解析失败
  GENERATED --> DISPLAY_READY: 共用输出校验通过
  GENERATED --> DISCARDED: 共用输出校验失败
  DISPLAY_READY --> DISPLAYED: 浮窗首帧完成
  DISPLAY_READY --> DISCARDED: stale 或取消
  DISPLAYED --> HIDDEN: 展示窗口到期
  FILTERED --> [*]
  DISCARDED --> [*]
  FAILED --> [*]
  HIDDEN --> [*]
```

### 8.3 打标回流同步状态机

```mermaid
stateDiagram-v2
  [*] --> NOT_REQUIRED
  NOT_REQUIRED --> PENDING: 修正答案 或 认可分数大于等于 85
  NOT_REQUIRED --> PENDING: golden 直出被拒绝且无修正
  PENDING --> SYNCED: Qdrant 幂等写入或 bad case 更新成功
  PENDING --> FAILED: Qdrant 暂时失败
  FAILED --> PENDING: 后台受控重试
  SYNCED --> PENDING: 用户编辑有效反馈
```

内部 `sync_status` 不在用户页面公开；用户只看到 `UNLABELED`、`ACCEPTED`、`REJECTED`、`CORRECTED`、`NOT_APPLICABLE`。

## 9. 设计可追溯与图册使用说明

| 图册内容 | 主要上游依据 | 下游使用 |
| --- | --- | --- |
| 服务门禁、展示抑制、停止策略 | 需求 D-07a、D-12、D-18；PRD FR-05、FR-08 | Main 状态机、接入 POC、验收用例 |
| 人设路由、双库检索、直出/LLM | 需求 D-13、D-16、D-17；PRD FR-03、FR-05、FR-06 | 检索模块、Prompt、审计快照 |
| jieba-BM25 数据流 | 技术调研与数据接口协议中的检索 profile | 向量编码、Qdrant 初始化、算法 fixture |
| DFD 和审计时序 | 需求 D-15、D-18；PRD FR-10 | SQLite DDL、IPC、权限与安全测试 |
| 打标回流 | 需求 D-17；PRD FR-10；架构 4.3 | feedback/outbox、golden_set 同步测试 |

本图册的 Mermaid 源码应与实现一同维护。状态、数据源、隐私边界或检索 profile 发生变更时，必须同步更新图册、接口协议、迁移和验收用例，禁止只改其中一项。
