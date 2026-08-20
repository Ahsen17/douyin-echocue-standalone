# Echocue 数据模型、接口与实时事件协议 v0.1

> 状态：v0.1 详细设计  
> 范围：Windows x64 standalone MVP  
> 本文是开发契约；未列出的字段不得由 Renderer 直接猜测或读取。

## 1. 数据归属

| 存储/通道 | 事实来源 | 允许保存 |
| --- | --- | --- |
| SQLite `audit/audit.sqlite` | 人设版本、审计、打标与同步状态。 | 受字段加密保护的原文、快照、版本、反馈。 |
| 本机配置文件 | 直播间引用、`model_id`、禁忌规则、关键词、浮窗偏好与内部阈值。 | 原子写入的非密钥配置；API Key 例外，见 safeStorage。 |
| Qdrant `pre_set` | 通用相似案例。 | 稀疏向量、通用案例 payload。 |
| Qdrant `golden_set` | 主播认可/修正答案。 | 稀疏向量、版本绑定 payload、可直出回复/提词。 |
| Electron safeStorage | 密钥事实来源。 | DeepSeek API Key；严禁落入 SQLite/Qdrant/日志。 |
| Prometheus / OTel | 非事实诊断。 | 匿名计数、类别、耗时；不得含原文或 `trace_id`。 |

SQLite 由 `AuditStoreWorker` 独占。Renderer 不可打开数据库、Qdrant 或网络连接；只通过 preload 白名单 IPC 请求已授权的视图数据。

## 2. 标识、时间与枚举

- 所有 UUID 使用 UUID v7；时间使用 ISO-8601 UTC 字符串；时延在内存中使用单调时钟毫秒数。
- `session_id`：一次用户手动启动且通过 `ROOM_ONLINE` 门禁后的直播会话。
- `trace_id`：一条进入处理链路的弹幕；过滤弹幕同样必须存在 trace。
- `persona_version`：不可变版本 UUID；内容 hash 使用 SHA-256 小写 hex。
- `collection` 只能为 `pre_set` 或 `golden_set`。
- `retrieval_confidence` 必须为 `[0.00, 1.00]`；原始 BM25 score 不得跨 collection 比较。

```ts
type LabelStatus =
  | 'UNLABELED' | 'ACCEPTED' | 'REJECTED' | 'CORRECTED' | 'NOT_APPLICABLE';
type InternalSyncStatus = 'NOT_REQUIRED' | 'PENDING' | 'SYNCED' | 'FAILED';
type TraceState =
  | 'RECEIVED' | 'NORMALIZED' | 'FILTERED' | 'ROUTED' | 'RETRIEVING'
  | 'DIRECT_READY' | 'PROMPT_RENDERED' | 'LLM_PENDING' | 'GENERATED'
  | 'DISPLAY_READY' | 'DISPLAYED' | 'EXPIRED' | 'DISCARDED' | 'FAILED';
type TraceFinalState =
  | 'FILTERED' | 'DISCARDED' | 'FAILED' | 'EXPIRED';
```

## 3. SQLite 逻辑模型与 DDL

所有 DDL 由 migration 执行；启动时启用 `foreign_keys=ON`、`journal_mode=WAL`、合理 `busy_timeout`。加密快照列以 AES-GCM envelope BLOB 保存，禁止存储 API Key/Cookie/Authorization header。

```sql
CREATE TABLE schema_migration (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE persona (
  persona_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_principal INTEGER NOT NULL CHECK (is_principal IN (0,1)),
  active_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX ux_persona_one_principal ON persona(is_principal) WHERE is_principal = 1;

CREATE TABLE persona_version (
  persona_version TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(persona_id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  content_envelope BLOB NOT NULL,
  content_hmac TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  created_from_version TEXT,
  UNIQUE(persona_id, persona_version),
  UNIQUE(persona_id, content_hmac)
) STRICT;

CREATE TABLE persona_alias (
  alias_id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES persona(persona_id),
  alias_text TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('NAME','NICKNAME','ALIAS','TYPO_VARIANT')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  UNIQUE(persona_id, alias_text)
) STRICT;

CREATE TABLE live_session (
  session_id TEXT PRIMARY KEY,
  room_reference TEXT NOT NULL,
  platform_room_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT
) STRICT;

CREATE TABLE audit_trace (
  trace_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_session(session_id),
  source_message_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  final_state TEXT CHECK (final_state IN ('FILTERED','DISCARDED','FAILED','EXPIRED','DISPLAYED')),
  label_status TEXT NOT NULL DEFAULT 'UNLABELED' CHECK (label_status IN ('UNLABELED','ACCEPTED','REJECTED','CORRECTED','NOT_APPLICABLE')),
  current_feedback_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, source_message_id)
) STRICT;

CREATE TABLE audit_transition (
  trace_id TEXT NOT NULL REFERENCES audit_trace(trace_id),
  sequence_no INTEGER NOT NULL,
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('RECEIVED','NORMALIZED','FILTERED','ROUTED','RETRIEVING','DIRECT_READY','PROMPT_RENDERED','LLM_PENDING','GENERATED','DISPLAY_READY','DISPLAYED','EXPIRED','DISCARDED','FAILED')),
  to_state TEXT NOT NULL CHECK (to_state IN ('RECEIVED','NORMALIZED','FILTERED','ROUTED','RETRIEVING','DIRECT_READY','PROMPT_RENDERED','LLM_PENDING','GENERATED','DISPLAY_READY','DISPLAYED','EXPIRED','DISCARDED','FAILED')),
  reason_code TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hmac TEXT,
  entry_hmac TEXT NOT NULL,
  PRIMARY KEY(trace_id, sequence_no)
) STRICT;

CREATE TABLE audit_snapshot (
  snapshot_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  envelope BLOB NOT NULL,
  content_hmac TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_reference (
  trace_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES audit_snapshot(snapshot_id),
  role TEXT NOT NULL,
  PRIMARY KEY(trace_id, sequence_no, snapshot_id),
  FOREIGN KEY(trace_id, sequence_no) REFERENCES audit_transition(trace_id, sequence_no)
) STRICT;

CREATE TABLE suggestion_feedback (
  feedback_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES audit_trace(trace_id),
  revision_no INTEGER NOT NULL,
  persona_id TEXT NOT NULL,
  persona_version TEXT NOT NULL,
  quality_score INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  correction_envelope BLOB,
  label_status TEXT NOT NULL CHECK (label_status IN ('UNLABELED','ACCEPTED','REJECTED','CORRECTED','NOT_APPLICABLE')),
  sync_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (sync_status IN ('NOT_REQUIRED','PENDING','SYNCED','FAILED')),
  is_bad_case INTEGER NOT NULL DEFAULT 0 CHECK (is_bad_case IN (0,1)),
  source_collection TEXT CHECK (source_collection IN ('pre_set','golden_set')),
  source_point_id TEXT,
  target_point_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(trace_id, revision_no),
  FOREIGN KEY(persona_id, persona_version) REFERENCES persona_version(persona_id, persona_version)
) STRICT;

CREATE TABLE qdrant_sync_job (
  job_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES suggestion_feedback(feedback_id),
  target_collection TEXT NOT NULL CHECK (target_collection IN ('golden_set','pre_set')),
  action TEXT NOT NULL CHECK (action IN ('UPSERT','SET_BAD_CASE')),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE audit_meta (
  key TEXT PRIMARY KEY,
  value_envelope BLOB NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

所有敏感列只保存一个 canonical envelope BLOB，其 UTF-8 JSON 结构固定为 `{alg:'AES-256-GCM',keyVersion,nonceB64,ciphertextB64,tagB64,aadVersion:'1'}`；不得拆列或另行解释 ciphertext。AAD 为 `tableName|primaryKey|columnOrContentType|aadVersion`。数据加密密钥与 HMAC 密钥必须独立随机生成，由 `safeStorage`/DPAPI 包装保存；`audit_meta` 保存加密的链锚点与密钥元数据。禁止存储无密钥普通 SHA-256：所有内容完整性摘要使用 HMAC-SHA-256，输入采用 UTF-8 canonical JSON。

`persona.active_version` 与 `created_from_version` 必须在发布事务中校验其所属 `persona_id`，不得仅靠字符串赋值。migration 必须包含以下完整约束；`current_feedback_id` 同样由 Worker 在事务内校验其属于本 trace。SQLite 不负责复杂状态图：`AuditStoreWorker.appendTransition()` 必须在单个事务中读取前一状态、校验下表允许迁移、写入 transition/快照/trace 终态；非法迁移一律抛出 `E_AUDIT_STATE_INVALID`。

```sql
CREATE TRIGGER persona_active_version_guard_insert
BEFORE INSERT ON persona WHEN NEW.active_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.active_version
      AND pv.persona_id = NEW.persona_id AND pv.status = 'PUBLISHED'
  ) THEN RAISE(ABORT, 'invalid active persona version') END;
END;

CREATE TRIGGER persona_active_version_guard_update
BEFORE UPDATE OF active_version ON persona WHEN NEW.active_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.active_version
      AND pv.persona_id = NEW.persona_id AND pv.status = 'PUBLISHED'
  ) THEN RAISE(ABORT, 'invalid active persona version') END;
END;

CREATE TRIGGER persona_version_parent_guard
BEFORE INSERT ON persona_version WHEN NEW.created_from_version IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM persona_version pv
    WHERE pv.persona_version = NEW.created_from_version
      AND pv.persona_id = NEW.persona_id
  ) THEN RAISE(ABORT, 'invalid parent persona version') END;
END;
```

| from | 允许 to |
| --- | --- |
| `null` | `RECEIVED` |
| `RECEIVED` | `NORMALIZED` |
| `NORMALIZED` | `FILTERED`、`ROUTED`、`DISCARDED` |
| `ROUTED` | `RETRIEVING` |
| `RETRIEVING` | `DIRECT_READY`、`PROMPT_RENDERED`、`DISCARDED` |
| `DIRECT_READY` | `DISPLAY_READY` |
| `PROMPT_RENDERED` | `LLM_PENDING` |
| `LLM_PENDING` | `GENERATED`、`FAILED`、`DISCARDED` |
| `GENERATED` | `DISPLAY_READY`、`DISCARDED` |
| `DISPLAY_READY` | `DISPLAYED`、`DISCARDED` |
| `DISPLAYED` | `EXPIRED` |

`audit_snapshot` 的 `content_type` 和 `audit_reference.role` 只能是下表值。

| 转换/阶段 | 必需快照 role |
| --- | --- |
| `RECEIVED` / `NORMALIZED` | `RAW_WS_EVENT`、`NORMALIZED_COMMENT` |
| `FILTERED` | `FILTER_DECISION` |
| `ROUTED` | `PERSONA_ROUTE`、`PERSONA_VERSION_SNAPSHOT` |
| `RETRIEVING` | `GOLDEN_QUERY_RESULT`、`PRE_QUERY_RESULT`、`RERANK_DECISION` |
| `PROMPT_RENDERED` / `LLM_PENDING` | `RENDERED_PROMPT`、`LLM_REQUEST_META` |
| `GENERATED` | `LLM_RAW_RESPONSE`、`LLM_PARSED_OUTPUT`、`OUTPUT_VALIDATION` |
| `DIRECT_READY` | `DIRECT_PAYLOAD`、`DIRECT_DECISION` |
| `DISPLAYED` / 终态 | `OVERLAY_RESULT`、`FINAL_REASON` |

`audit_trace.label_status` 是用户可见状态；`suggestion_feedback.sync_status` 与 outbox job 状态仅内部可见。

非审计配置固定保存在 `config/settings.json`，通过“写入临时文件 → fsync → 原子 rename”更新；其 Zod schema 为：

```ts
interface SettingsV1 {
  schemaVersion: 1;
  roomReference?: string;
  modelId?: string;
  forbiddenPolicyText: string;
  forbiddenKeywords: string[];
  overlay: { durationMs: number; width: number; height: number; opacity: number; fontScale: number; theme: 'light'|'dark'; clickThrough: boolean };
  internalRetrieval: { calibrationVersion: string; directPushThreshold: number; windowMaxAgeMs: number; candidateMaxCount: number };
}
```

`config.get/update` 只能传递此 schema 的允许字段；`internalRetrieval` 不在用户设置界面显示，且只能由受控配置/POC 变更。API Key 不属于该文件。

golden 回流采用 transactional outbox：`audit.submitLabel` 在同一 SQLite 事务内写入 feedback 修订、更新 trace 的用户可见 `label_status`，并在需要回流时写入唯一 `qdrant_sync_job`。job 是同步的唯一事实来源；`suggestion_feedback.sync_status` 只由 job 状态派生，禁止独立写入。worker 以 `idempotency_key=feedbackId:revisionNo:action` 领取 job，Qdrant 成功后在同一 SQLite 事务标记 `SUCCEEDED/SYNCED`；失败指数退避重试，保留错误审计。重复提交同一修订不可产生重复 job。仅 `GOLDEN_SYNC_FAILED` 的内部诊断可触发人工修复重试，用户打标页面不可见。

修正答案回流时，`case_id = feedback:{feedback_id}:{revision_no}`，`target_point_id = UUIDv5('echocue:golden_set:' + case_id)`，明文为 canonical JSON `CorrectionPayloadV1`，写入前复用输出长度/安全校验器。未修正且评分 `>=85` 时使用同样规则，但 reply/cues 来自该 trace 已审计的最终输出。拒绝且未修正时，只有 `source_collection='golden_set' AND source_point_id IS NOT NULL` 才创建 `SET_BAD_CASE` job；否则 `sync_status=NOT_REQUIRED`。

## 4. Qdrant collection 契约

两库均为单路稀疏 **jieba-BM25** collection，固定 vector name 为 `bm25_zh_jieba_v1`；由随安装包分发的 Qdrant Server `>= 1.19.0` 提供 sparse index 与 query-time `modifier: 'idf'`。`pre_set` 初始导入由甲方提交的标准 JSONL 完成，`golden_set` 初始为空、由审计打标生成。`Bm25TextPipeline` 固定版本 `zh_jieba_search_v1`：regex 移除无关符号、Unicode NFKC/全半角统一、空白折叠、受控同义/热词归一，再以 `jieba-wasm.cut_for_search` 分词；每个 point 写入 `tokenizer_version`。具体 Qdrant REST 请求由 `SuggestionRetriever` 封装，业务层不直接发请求。

`case_id` 是业务稳定 ID；Qdrant `point_id` 为确定性 UUIDv5：`UUIDv5('echocue:{collection}:{case_id}')`。`pre_set` 的 JSONL `id` 映射为 `case_id`，不得直接假设其符合 Qdrant point ID 格式；检索、审计、bad-case 更新同时记录二者。

collection bootstrap 必须创建 `bm25_zh_jieba_v1` 稀疏向量（`modifier: 'idf'`）及 payload index：`enabled`、`is_bad_case`、`semantic_type`，以及 `golden_set` 的 `persona_id`、`persona_version`。导入器拒绝不支持的 `schema_version`，且将 `pre_set` 的 `schema_version`、`case_id`、`tokenizer_version` 写入 payload。查询阶段**不得**按未知 `semantic_type` 预过滤；先检索全类型可用样本，再按第 4.3 节投票得出初筛结论，避免“先知道类型才能检索”的循环。

`Bm25TextPipelineV1` 是唯一允许的文本处理器，写入与查询必须使用完全相同的 regex、Unicode 规范、同义/热词词表和 `jieba-wasm.cut_for_search`。它以 Qdrant FastEmbed BM25 的文档侧权重语义为算法参照，但中文 token 以 jieba 结果替代其英文 Snowball stemmer/stopword pipeline。分词后删除空 token 与纯标点，保留 token 出现次数 `tf(t,d)`；token 的 index 必须与 FastEmbed `compute_token_id` 对齐：`abs(MurmurHash3_x86_32(UTF8(token), seed=0))`，不得维护词典或改用 SHA/其他 hash。TS 使用 `murmurhash3js-revisited` 对 UTF-8 bytes 计算 x86 32-bit hash，再转换为 signed 32-bit 后取绝对值；每个发布版本必须通过 FastEmbed/Python `mmh3` 的跨语言 index fixture（含中文、emoji、ASCII）。32-bit hash 碰撞是理论可发生的；MVP 记录 collision 指标，若单文档检测到不同 token 映射到同一 ID，则保留审计诊断并纳入 POC 评估，不能悄然改用有状态词典破坏 index 稳定性。对文档 `d`，写入值严格为：`w_d(t) = tf(t,d) * (k1 + 1) / (tf(t,d) + k1 * (1 - b + b * doc_len / avg_doc_len))`；其中 `doc_len` 是分词后的 token 总数，`k1`、`b` 与 `avg_doc_len_baseline` 由真实中文样本 POC 校准并固化在 `Bm25ZhJiebaProfileV1`（FastEmbed 默认值为 `1.2`、`0.75`，仅作为 POC 初始值）。`avg_doc_len_baseline` 在首次导入完整 `pre_set` 后，以其有效案例的 token 长度均值计算；两个 collection 都复用该值，运行中不可变。**写入值不含 IDF。** Qdrant 的 `modifier: 'idf'` 按各 collection 当前文档频率在查询时自动计算并乘入 IDF；IDF 不依赖 `avg_doc_len_baseline`，将 IDF 预写入文档会双重加权，禁止。

查询路径执行同一前处理与分词，将 token 去重后写为 `{ index, value: 1 }`，不计算 tf、文档长度或 IDF；发送 named sparse vector `{ name: 'bm25_zh_jieba_v1', indices, values }`，同时带本次 collection 的 payload filter。Qdrant 负责将 query term 以 IDF 修正并与文档侧 `w_d(t)` 点积，得到 BM25 raw score。单次 golden 回流仅按当前固定 profile 写入一个 point，禁止重算已有点或重建 collection。只有 `avg_doc_len_baseline`、`k1`、`b`、tokenizer、归一/热词规则或 token-index namespace 变更，才创建新 profile/collection，批量重编码 `pre_set` 与有效 `golden_set`，完成校验后原子切换；不能在直播中途静默改变。Qdrant 版本、`tokenizer_version`、`bm25_profile_id`、同义词词表版本和 calibration artifact ID 必须写入 collection metadata 与每次检索审计。

### 4.1 `pre_set` payload

```ts
interface PreSetPayload {
  schema_version: '1.0';
  case_id: string;
  tokenizer_version: 'zh_jieba_search_v1';
  text: string;
  semantic_type: string;
  description: string;
  reference_reply?: string;
  reference_cues?: string[];
  tags?: string[];
  enabled: boolean;
  is_bad_case: boolean;
}
```

查询 filter：`enabled=true AND is_bad_case=false`，不加 `persona_version` 或 `semantic_type` 限制。命中只能作为分类/LLM 上下文，禁止直出。

### 4.2 `golden_set` payload

```ts
interface GoldenSetPayload {
  case_id: string;
  tokenizer_version: 'zh_jieba_search_v1';
  source_trace_id: string;
  persona_id: string;
  persona_version: string;
  text: string;
  semantic_type: string;
  reply: string;
  cues: string[];
  quality_score: number;
  enabled: boolean;
  is_bad_case: boolean;
  created_at: string;
  updated_at: string;
}
```

查询 filter：`persona_id=current AND persona_version=current AND enabled=true AND is_bad_case=false`，不加 `semantic_type` 限制。只有 Top-1 来自该库且置信度达到内部 `direct_push_threshold` 才能直出。

### 4.3 初筛分类动作

两路命中按 `retrieval_confidence` 校准/rerank 后，先聚合 `semantic_type`：`filter_risk` 或 `low_value` 只有在同类命中置信度达到内部“明确丢弃”阈值且没有更高置信度正向互动命中时，才记为 `DISCARDED`；任何灰区均进入候选/LLM 路径。`persona_relevant`、`positive_praise`、`funny_joke`、`interactive_question`、`atmosphere_boost` 是正向互动类型。硬规则永远先于此逻辑。

bad case 对象必须明确：仅当当前浮窗建议由 `golden_set` point 直接推送时，拒绝且无修正可对该 `source_collection='golden_set'`、`source_point_id` 执行 `SET_BAD_CASE`。LLM fallback 或 `pre_set` 参考命中被拒绝时，不得标坏任何 `pre_set` point，也不得自动创建负例 point；只在审计中保留拒绝反馈。这样 bad case 仅排除其自身，不泛化为相似语义的负面判断。

### 4.4 双路检索响应

```ts
interface RetrievalHit {
  pointId: string;
  caseId: string;
  collection: 'pre_set' | 'golden_set';
  rawScore: number;
  retrievalConfidence: number; // calibration 后 [0, 1]
  rank: number;
  payload: PreSetPayload | GoldenSetPayload;
}

interface RetrievalResult {
  traceId: string;
  calibrationVersion: string;
  goldenHits: RetrievalHit[];
  preHits: RetrievalHit[];
  mergedTopK: RetrievalHit[];
  directPushEligible: boolean;
  directPointId?: string;
}
```

校准函数与阈值只存于内部配置和审计快照，绝不通过用户 UI/IPC 暴露。

```ts
interface ServiceViewState {
  lifecycle: 'STOPPED' | 'GATE_CONNECTING' | 'RUNNING' | 'DISPLAYING';
  activity: 'IDLE' | 'LISTENING' | 'RETRIEVING' | 'GENERATING' | 'DISPLAYING';
  stopReason?: 'USER_STOP' | 'ROOM_OFFLINE' | 'ROOM_ENDED' | 'SOURCE_ERROR' | 'AUDIT_UNAVAILABLE';
  recoverableError?: { code: string; at: string };
}
```

`lifecycle` 与 `activity` 由 Main 以 `service.state.changed` 统一推送，Renderer 不得推导“生成中”或异常状态。

## 5. `douyinLive` 适配器事件

适配器只接收 `ws://127.0.0.1:1088/ws/{roomReference}`，并转换为下列领域事件：

```ts
type LiveSourceEvent =
  | { type: 'LIVE_ONLINE'; roomReference: string; platformRoomId?: string; receivedAt: string }
  | { type: 'LIVE_OFFLINE'; roomReference: string; receivedAt: string }
  | { type: 'LIVE_ENDED'; roomReference: string; receivedAt: string }
  | { type: 'COMMENT'; comment: SourceComment }
  | { type: 'SOURCE_ERROR'; code: string; message: string; receivedAt: string };

interface SourceComment {
  sourceMessageId: string;
  platformRoomId?: string;
  rawEvent: unknown;
  rawText: string;
  normalizedText: string;
  userNickname?: string;
  upstreamCreatedAt?: string;
  receivedAt: string;
}

interface ProcessingComment extends SourceComment {
  sessionId: string;
  traceId: string;
  windowVersion: number;
  receivedMonotonicMs: number; // t0
  freshnessDeadlineMonotonicMs: number;
}
```

- `ROOM_ONLINE` → `LIVE_ONLINE`，通过启动门禁；
- `ROOM_OFFLINE` → `LIVE_OFFLINE`，立即关闭本地 WS；
- `ROOM_ENDED` → `LIVE_ENDED`，停止服务并关闭本地 WS；
- `WebcastChatMessage` → `COMMENT`；礼物、点赞只用于匿名连接诊断，不能进入生成。

## 6. Provider 与 DeepSeek 输出

```ts
interface GenerateSuggestionRequest {
  sessionId: string;
  traceId: string;
  windowVersion: number;
  modelId: string;
  timeoutMs: 5000;
  selectedAtMonotonicMs: number;
  freshnessDeadlineMonotonicMs: number;
  abortSignal: AbortSignal;
  persona: PersonaRoute;
  comment: ProcessingComment;
  retrievalContext: RetrievalHit[];
}

interface GenerateSuggestionResponse {
  providerRequestId?: string;
  modelId: string;
  quickReply: string;
  cues: string[];
}

interface ProviderAuditRecord {
  providerRequestId?: string;
  modelId: string;
  rawRequest: unknown;
  rawResponse?: unknown;
  normalizedError?: string;
}

interface CorrectionPayloadV1 {
  schemaVersion: 1;
  quickReply: string;
  cues: string[];
}
```

`ProcessingComment` 由 Service Orchestrator 在适配器输出 `SourceComment` 后创建；它分配 `traceId` 并绑定当前 session/window。`freshnessDeadlineMonotonicMs = min(t0 + 3000ms, candidateSelectedAt + 2500ms, windowOpenedAt + windowMaxAgeMs)`；其中 `t0=receivedMonotonicMs`，`windowMaxAgeMs` 为内部配置/POC 校准值。`SuggestionAttempt` 在检索、生成和浮窗调用前后都必须二次比对 `sessionId + traceId + windowVersion + freshnessDeadlineMonotonicMs`；任一不符写 `DISCARDED`，reason code 为 `STALE_SESSION`、`STALE_WINDOW` 或 `DEADLINE_EXCEEDED`。`t1=筛选完成`，`t2=本地输出校验完成`，`t3=浮窗首帧`，四个值写入对应审计快照。

模型必须返回 JSON：

```json
{
  "quick_reply": "一句可直接口播的短回复",
  "cues": ["两到三条组织语言提示", "每条简短可执行"]
}
```

`DeepSeekProvider` 固定使用 DeepSeek OpenAI-compatible `POST /chat/completions`；非流式、非思考模式、禁用 tool calls，传递 `response_format: { type: 'json_object' }`。统一错误类型为 `AUTH`（401）、`BILLING`（402）、`VALIDATION`（400/422）、`RATE_LIMIT`（429）、`SERVER`（5xx）、`TIMEOUT` 和 `ABORTED`；业务层只接收上述错误与结构化结果，`rawResponse` 只写加密审计快照，不向业务/Renderer 返回。

本地校验：`quick_reply` 非空且不超过 80 汉字；`cues` 为 **2–3 条**、每条不超过 40 汉字；不得出现硬规则风险内容。校验失败、超时、provider 异常均只记录审计并回到监听，绝不重试过期弹幕。

## 7. Electron IPC 白名单

主窗口与浮窗必须使用不同 preload：`mainWindowPreload` 暴露下表主窗口能力；`overlayPreload` 仅暴露 `overlay.renderSuggestion`、`overlay.hide` 与偏好只读事件，绝不暴露配置、人设、审计或服务控制。所有通道通过 `contextBridge` 暴露；请求/响应用 Zod schema 校验。每个 `ipcMain.handle/on` 还必须校验 `event.sender.id` 属于预期窗口、窗口类型和当前受信任应用 URL；任何未知通道、非预期字段或越权 trace 查询均拒绝。

| IPC | Renderer → Main 请求 | Main → Renderer 响应/事件 |
| --- | --- | --- |
| `service.start` | `roomReference` | `ServiceViewState` |
| `service.stop` | 无 | `ServiceViewState` |
| `service.state.subscribe` | 无 | `service.state.changed` |
| `config.get` / `config.update` | 白名单配置字段 | 脱敏配置视图 |
| `persona.list/get/saveDraft/publish` | 人设与版本操作 | 人设摘要/版本摘要 |
| `audit.search` | 时间、label 状态、分页 | `AuditTraceSummary[]` |
| `audit.getWorkflow` | `traceId` | 完整 workflow 上下文 |
| `audit.submitLabel` | 评分、拒绝/修正内容 | 用户可见 `labelStatus` |
| `overlay.preference.update` | 白名单浮窗偏好 | 更新后偏好 |
| `window.showMain` | 无 | 成功/错误 |

`audit.getWorkflow` 仅在用户主动进入 workflow 上下文入口时触发；`audit.submitLabel` 只返回用户可见打标状态，不返回 golden 回流或同步状态。

`audit.search` 强制 `pageSize` 为 1–100，默认按 `received_at DESC`；`audit.getWorkflow` 只接受 UUID v7 `traceId`。订阅 IPC 返回取消函数，窗口销毁时 Main 必须自动注销订阅。主窗口禁止任意外部导航和新窗口创建；浮窗加载独立本地路由，不能跳转到主窗口路由。

## 8. 错误码

| 代码 | 层 | 用户提示 | 系统动作 |
| --- | --- | --- | --- |
| `E_CONFIG_MISSING` | 配置 | 请完善直播间、人设或模型配置。 | 拒绝启动。 |
| `E_AUDIT_UNAVAILABLE` | 审计 | 审计存储不可用，请处理后重新启动。 | 停止服务。 |
| `E_QDRANT_UNAVAILABLE` | 检索 | 本地检索服务不可用，请重试。 | 拒绝启动。 |
| `E_ROOM_OFFLINE` | 接入 | 直播间尚未开播，请稍后手动启动。 | 关闭 WS，停止服务。 |
| `E_ROOM_ENDED` | 接入 | 直播已结束，服务已停止。 | 清空/隐藏/关闭 WS。 |
| `E_LLM_TIMEOUT` | 模型 | 本轮建议未生成，正在继续监听。 | 审计失败，不重试。 |
| `E_LLM_PROVIDER` | 模型 | 本轮建议未生成，正在继续监听。 | 审计失败，不重试。 |
| `E_GOLDEN_SYNC` | 回流 | 不向用户展示。 | 内部记录失败并重试。 |

## 9. 实施验收点

1. migration 可从空库升级，且重复启动不重复执行；
2. 人设发布产生不可变版本，服务运行中不热切换；
3. `pre_set`/`golden_set` filters、双路结果、calibration 和 rerank 完整审计；
4. golden 高置信 Top-1 直出，其他情况恰好一次模型调用；
5. 被拒绝且无修正的 `golden_set` 直出 point 在后续检索中不可返回；LLM/pre_set 路径不得修改通用案例 point；
6. 主窗口关闭只隐藏到托盘；显式退出才完整停止服务；
7. 审计工作区能分别进入 workflow 上下文和打标操作，且不泄露内部回流机制。
