# 运行策略

## 互动类型

MVP 弹幕语义分类围绕互动价值识别：

| 枚举值 | 业务解释 |
| --- | --- |
| `playful_joke` | 有梗、玩笑、反差或适合接话的弹幕。 |
| `persona_praise` | 夸主播、夸团队、夸人设或夸现场表现的弹幕。 |
| `interactive_prompt` | 主动抛话题、邀请主播回应或适合延展讨论的弹幕。 |
| `atmosphere_boost` | 能带动现场气氛、起哄、互动或接续直播间话题的弹幕。 |
| `other` | 不适合作为本轮互动回复的弹幕。 |

语义分类服务承担轻量初筛：基于弹幕窗口 batch、互动价值样本、Qdrant sparse 召回和 TopK 投票，筛出具备互动价值的窗口 / 候选。大模型 Agent 只处理初筛后的候选，不逐条判断全量弹幕。

分类服务输出窗口级主互动类型和 TopN 候选弹幕列表。TopN 默认 5，允许范围 1-10。最高候选类型置信度低于 0.55 时返回 `other`。

一条弹幕同时符合多个互动类型时，MVP 按以下优先级归类：

```text
persona_praise > interactive_prompt > playful_joke > atmosphere_boost > other
```

## 直播状态

AI 服务只在直播间处于开播状态时运行。开播状态由 douyinLive `live_status` 系统事件维护：

| code | 处理策略 |
| --- | --- |
| `ROOM_ONLINE` | 标记直播间开播，允许进入 AI 服务启动门禁。 |
| `ROOM_ENDED` | 标记直播间下播，自动停止对应直播间 AI 服务。 |
| `ROOM_OFFLINE` | 标记直播间未开播，启动流程阻断并断开本次 douyinLive WS。 |

启动阶段通过 douyinLive WebSocket 首个 `live_status` 判断直播状态。运行中收到 `ROOM_ENDED` 时，服务端停止该直播间 AI 服务并通知 client 关闭浮窗。

## 启动门禁

用户在 client 选择直播间并点击“启动 AI 助手”后，按顺序执行：

1. 校验 client 登录态。
2. 主后端调用账号权限微服务获取账号、认证、机构、成员和直播间授权上下文，并完成直播间权限判断。
3. 校验单用户单 client 会话。
4. 通过 Redis 分布式锁校验同直播间 active client 锁。
5. 连接 douyinLive WebSocket，读取首个 `live_status`，必须为 `ROOM_ONLINE`。
6. 校验直播间主体档案存在已发布版本。
7. 服务端执行安全规则版本与冲突门禁。
8. 初始化 AI 服务会话，固化直播间 ID、主体档案 ID + 版本号、适用规则版本、启动用户和 client 信息。

模型服务是平台基础能力，不作为用户侧启动门禁；异常时按平台服务异常处理。

账号权限微服务只提供数据管理、权限上下文查询和权限判断接口；Web / client 登录态、client 会话、active client 锁和最终启动门禁由主后端维护。

Redis active client 锁使用心跳续租 + TTL 自动释放策略。client 每 10 秒发送心跳，服务端续租；连续 30 秒未收到心跳后，服务端判定断线、停止该 client 持有的 AI 服务并释放锁。

## 账号权限

账号权限体系由独立 `auth` gRPC 微服务承载。Web 和 client 只访问主后端，主后端再调用账号权限微服务。

账号权限微服务负责：

| 能力 | 业务解释 |
| --- | --- |
| 凭据校验 | 主后端接收 Web / client 登录请求后调用微服务校验，成功后由主后端维护自身登录态。 |
| 数据管理 | 管理账户、认证、机构、成员、直播间和直播间授权。 |
| 权限上下文聚合 | 一次返回账户、认证、机构、成员和直播间授权上下文。 |
| 权限判断 | 判断用户是否可查看、编辑、回放或启动某直播间 AI 助手。 |

认证状态：

| 状态 | 业务解释 |
| --- | --- |
| `uncertified` | 未认证账号，只能看到登录和认证引导。 |
| `personal_certified` | 个人认证账号，只能绑定并管理一个自有直播间。 |
| `organization_certified` | 机构认证账号，可管理机构、成员、多个机构自有直播间和回放。 |

受邀个人直播间在机构下可被机构查看基础状态和回放，但机构不能修改该个人直播间配置。

## 模型 provider 运行策略

模型 provider 列表来自配置文件，普通用户不可见。运行时可用状态、失败次数、调用次数和当前选择记录在 Redis，平台自动轮询切换，不提供人工切换入口。

Agent 不感知 provider 切换策略，只按平台当前指定的 provider/model 执行 attempts。单个 Agent attempts 全失败后，当前 Workflow 向上返回失败信息。

平台按 `provider + model_id` 统计全局失败：

1. 只统计模型调用失败，例如超时、连接失败、服务端错误和限流。
2. Pydantic schema 校验失败不计入 provider/model 全局失败统计。
3. 同一 `provider + model_id` 在 1 分钟内连续出现 5 次 Agent attempts 全失败，标记该 model 暂不可用。
4. 不可用冷却时间默认为 5 分钟。
5. 冷却到期后，该 model 重新进入可尝试候选。
6. 已经开始的 Agent 调用不强制中断；后续新调用避开不可用 model。

自动选择策略：

1. 优先在当前 provider 内按配置顺序轮询可用 model_id。
2. 当前 provider 下所有 model 都不可用时，再切换到下一个 provider。
3. provider/model 状态可由平台管理员在 Web 管理端只读查看。
4. 普通用户和 client 不展示 provider/model 细节。

## Workflow 触发源

MVP 触发源只围绕弹幕：

| 枚举值 | 业务解释 |
| --- | --- |
| `scheduled_comment_window` | 固定时间窗口触发，用于持续扫描当前最值得回复的弹幕。 |
| `high_value_comment` | 单条弹幕互动价值很高时提前触发。 |

相似弹幕集中出现由窗口聚合层处理，只作为排序信号，不作为提前触发核心理由。

触发配置为直播间级配置，并可在 Web 管理端编辑。

每个触发源可以配置：

| 参数名 | 业务解释 |
| --- | --- |
| `enabled` | 当前触发源是否启用。 |
| `window_seconds` | 统计弹幕的时间窗口长度，单位为秒。 |
| `threshold` | 达到触发条件所需的最低计数或最低评分。 |
| `cooldown_seconds` | 两次成功推送之间的冷静期。 |
| `priority` | 多个触发源同时满足时的处理优先级。 |
| `max_triggers_per_minute` | 当前触发源每分钟最多触发次数。 |
| `min_comment_count` | 当前窗口内弹幕数量达到该值后才参与触发判断。 |

触发配置参数定义需要单独建表保存。服务启动时加载参数定义，用于后端校验和管理端表单渲染。触发配置为直播间级配置；直播间缺失配置时使用平台默认配置启动，并记录默认配置来源。

## 生成频率

使用混合触发策略：

- 固定时间窗口作为兜底。
- 高价值弹幕可提前触发。
- 通过冷静期控制成本与重复生成。

MVP 默认触发参数：

| 参数 | 默认值 | 业务解释 |
| --- | --- | --- |
| `scheduled_comment_window.window_seconds` | 10 | 每次判断最近 10 秒弹幕。 |
| `scheduled_comment_window.min_comment_count` | 1 | 最近 10 秒内只要有弹幕就参与判断。 |
| `scheduled_comment_window.scan_interval_seconds` | 10 | 定时窗口每 10 秒扫描一次。 |
| `cooldown_seconds` | 10 | 成功推送后 10 秒内不推送新回复。 |
| `max_triggers_per_minute` | 空 | MVP 不限制每分钟触发次数，仅由冷静期控制。 |
| `high_value_comment.threshold` | 0.7 | 命中提前触发类型且置信度不低于 0.7 时提前触发。 |

高价值弹幕提前触发仅适用于 `interactive_prompt`、`playful_joke` 和 `persona_praise`。高价值提前触发后，默认当前定时窗口也已触发；下一次定时窗口从高价值触发时间重新计 10 秒。

冷静期内不维护候选池，也不关注高价值弹幕是否出现。冷静期结束后，从当时最新滚动窗口重新判断触发。

## Workflow 输出

每次成功生成输出三段内容：

- 弹幕原文 / 概要：弹幕超过 10 个中文字符时生成概要，概要控制在 12 个中文字符以内；浮窗展示概要，Workflow 回放和 Agent 输入保留原文。
- 短回复：主播可以直接照读或略微改口的一句话，15 个中文字符以内。
- 提词：帮助主播扩展思路、接续话题的 2-3 个关键词，20 个中文字符以内。

推送动作：

| 枚举值 | 业务解释 |
| --- | --- |
| `push` | 安全且高置信度，自动推送到 active client。 |
| `skip` | 命中安全规则、低置信度、不符合人设或无足够互动价值，不推送。 |

MVP 不设置运营人工确认动作。

## Agent 执行与重试

Agent 输出通过 Pydantic 校验。

默认 attempts 为 3，即首次生成 + 最多 2 次失败重试。

校验失败后：

1. 保留 AI 原始输出。
2. 保留 Pydantic 校验错误。
3. 将两者增量加入 `model_context`，作为错误修正上下文。
4. 标明当前是第几次生成。
5. 让同一个 Agent 重新生成。

多次失败后的处理：

| Agent | 失败处理 |
| --- | --- |
| `InterestAgent` | 使用语义分类服务和程序评分兜底，并标记低置信度。 |
| `ReplyAgent` | 直接结束本轮 Workflow。 |
| 合并审核 Agent | 结合规则扫描、回复内容、主体档案和近期推送记录做最终 `push` / `skip` 裁决；多次失败时按安全不确定处理。 |

程序规则扫描只负责检出风险项，不直接裁决是否推送。规则命中时将命中项作为补充材料交给合并审核 Agent。最终推送动作由合并审核 Agent 裁决。

## Agent 输出结构

`InterestAgent` 输出：

| 字段名 | 业务解释 |
| --- | --- |
| `interest_score` | 弹幕互动价值评分。 |
| `interest_type` | 互动类型。 |
| `selected_comment_id` | 最终选择的弹幕 ID。 |
| `reason` | 内部评分原因，进入回放但不展示到浮窗。 |

`ReplyAgent` 输出：

| 字段名 | 业务解释 |
| --- | --- |
| `comment_display` | 弹幕原文或概要。 |
| `quick_reply` | 主播可以立即照读或近似照读的短回复。 |
| `cue` | 帮助主播扩展思路、接续话题的短提词。 |
| `confidence` | 生成结果置信度。 |

合并审核 Agent 输出：

| 字段名 | 业务解释 |
| --- | --- |
| `push_action` | 推送动作：`push`、`skip`。 |
| `review_category` | 结构化审核分类，例如 `safe_high_confidence`、`low_reply_quality`、`persona_mismatch`、`safety_uncertain`。 |
| `risk_categories` | 命中的安全风险类型。 |
| `skip_reason` | 不推送原因。 |
| `review_note` | 最终审核备注，进入回放。 |

合并审核 Agent 输入包括弹幕原文、主体档案、`ReplyAgent` 输出、程序规则扫描结果和最近 5 条已推送内容。近期已推送记录用于避免重复话术或连续接同类弹幕。

`skip_reason` 使用结构化枚举，并可配合 `review_note` 保存自然语言说明。低置信度相关原因至少拆分为 `low_interest_confidence`、`low_reply_confidence` 和 `low_safety_confidence`。

## Workflow 持久化

每一次 Workflow 执行都必须完整持久化到 PostgreSQL，用于回放、审计和 bad case 分析。

MVP 使用单表宽 JSONB 方案：一个 `workflow_runs` 表，每个 stage 对应一个 JSONB 字段。Stage 作为 Workflow 执行期间的内存结构存在，并在 Workflow 完成后写入对应 JSONB 字段。

Workflow 全局状态：

| 状态值 | 业务解释 |
| --- | --- |
| `pending` | 已创建，等待执行。 |
| `running` | Workflow 正在执行。 |
| `completed` | 流程正常跑完，无论最终 `push` 或 `skip`。 |
| `aborted` | 因关键业务条件不满足或关键 Agent 多次失败导致未能完成本轮业务流程。 |
| `failed` | 因系统异常、服务异常或基础设施错误导致执行失败。 |

Workflow 状态流转：

| 当前状态 | 允许转换到 | 业务解释 |
| --- | --- | --- |
| `pending` | `running`、`failed` | Workflow 等待执行或初始化失败。 |
| `running` | `completed`、`aborted`、`failed` | Workflow 执行并最终产出、业务中止或系统异常。 |
| `completed` | 无 | 已完成的 Workflow 保持最终状态。 |
| `aborted` | 无 | 因关键 Agent 失败或业务条件不满足而结束。 |
| `failed` | 无 | 因系统异常、服务异常或基础设施错误而结束。 |

关键全局状态使用独立字段，便于查询：

| 字段名 | 业务解释 |
| --- | --- |
| `tenant_id` | 当前 Workflow 所属租户或账户边界。 |
| `room_id` | 当前 Workflow 所属直播间。 |
| `persona_id` | 当前使用的直播间主体档案 ID。 |
| `persona_version` | 当前使用的主体档案版本号。 |
| `workflow_status` | Workflow 当前执行状态。 |
| `trigger_type` | 本轮 Workflow 的触发源。 |
| `semantic_type` | 本轮 Workflow 的互动类型。 |
| `push_action` | 本轮推送动作。 |
| `skip_reason` | 本轮未推送原因。 |
| `attempt_count` | 本轮 Workflow 中关键 Agent 的尝试次数汇总。 |
| `started_at` | Workflow 开始时间。 |
| `completed_at` | Workflow 结束时间。 |
| `latency_ms` | Workflow 总耗时，单位为毫秒。 |
| `pushed_to_client` | 本轮结果是否推送到 active client。 |
| `delivered_to_client` | client 是否 ACK 收到本轮消息。 |
| `global_rule_version` | 本轮适用的平台 global 规则版本。 |
| `organization_rule_version` | 本轮适用的机构规则版本，可为空。 |
| `room_rule_version` | 本轮适用的直播间规则版本，可为空。 |

每个 stage JSONB 字段使用统一 envelope：

```json
{
  "stage_name": "reply",
  "started_at": "2026-08-13T12:00:00Z",
  "completed_at": "2026-08-13T12:00:02Z",
  "latency_ms": 2130,
  "input": {},
  "output": {},
  "error": null,
  "attempts": []
}
```

Stage envelope 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | Stage 名称，用于标识当前 JSON 对应的执行阶段。 |
| `started_at` | Stage 开始时间。 |
| `completed_at` | Stage 结束时间。 |
| `latency_ms` | Stage 耗时。 |
| `input` | Stage 结构化输入。 |
| `output` | Stage 结构化输出。 |
| `error` | Stage 失败信息。 |
| `attempts` | Stage 内部重试明细，例如 Agent 输出校验重试。 |

Workflow stage 字段：

| Stage 字段名 | 业务解释 |
| --- | --- |
| `comment_window_stage` | 保存弹幕时间窗口、弹幕总数量等基础窗口信息。 |
| `trigger_evaluation_stage` | 保存触发源判断、阈值计算、冷静期和最终触发结果。 |
| `persona_context_stage` | 保存本轮使用的主体档案 ID 和版本号。 |
| `semantic_classification_stage` | 保存 Workflow batch 语义分类服务的请求与返回结果。 |
| `interest_stage` | 保存候选弹幕 Top N、评分和筛选原因。 |
| `reply_stage` | 保存 `ReplyAgent` 的输出和重试明细。 |
| `review_stage` | 保存规则扫描、审核判断、推送动作和不推送原因。 |
| `client_delivery_stage` | 保存向 active client 推送、ACK 和重试结果。 |

`comment_window_stage` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | 固定值 `comment_window`，标识该阶段。 |
| `window_started_at` | 弹幕统计窗口开始时间。 |
| `window_ended_at` | 弹幕统计窗口结束时间。 |
| `comment_count` | 窗口内弹幕总数量。 |
| `unique_user_count` | 窗口内去重后的用户数量。 |

`trigger_evaluation_stage` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | 固定值 `trigger_evaluation`。 |
| `evaluated_triggers` | 本轮参与判断的触发源及其配置快照。 |
| `matched_triggers` | 本轮命中的触发源列表。 |
| `selected_trigger_type` | 本轮最终选中的触发源。 |
| `cooldown_state` | 当前冷静期状态。 |
| `reason` | 选中该触发源的简短原因。 |

`persona_context_stage` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | 固定值 `persona_context`。 |
| `persona_id` | 主体档案 ID。 |
| `persona_version` | 主体档案版本号。 |
| `room_id` | 主体档案所属直播间。 |

`semantic_classification_stage` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | 固定值 `semantic_classification`。 |
| `request_id` | 与 gRPC 请求对应的交互任务 ID。 |
| `semantic_type` | 分类服务返回的互动类型。 |
| `request_comment_count` | 本次参与分类的弹幕总数量。 |
| `request_window_seconds` | 本次分类对应的弹幕统计窗口长度。 |
| `top_n` | 本次返回候选弹幕数量配置，默认 5。 |
| `confidence_threshold` | `other` 兜底阈值，MVP 固定为 0.55。 |
| `candidates` | TopN 候选弹幕列表。 |

Agent stage 的 `attempts` 标准结构：

| 字段名 | 业务解释 |
| --- | --- |
| `attempt_index` | 第几次生成，从 1 开始。 |
| `provider_name` | 模型服务商名称，普通用户不可见。 |
| `model_id` | 使用的模型 ID。 |
| `temperature` | 当前调用使用的 temperature。 |
| `timeout_ms` | 当前调用超时时间。 |
| `raw_output` | 模型原始输出。 |
| `validation_error` | Pydantic 校验失败信息。 |
| `latency_ms` | 本次模型调用和解析耗时。 |
| `token_usage` | 可选字段，保存 `prompt_tokens`、`completion_tokens`、`total_tokens`。 |

MVP 全量保存上下文。主体档案不保存快照，只保存 ID 和版本号。

## 安全规则

安全规则由平台 global 规则、机构 scope 规则和直播间 scope 规则合并执行。程序规则扫描命中后按最高风险等级汇总命中项，但不直接裁决是否推送；最终裁决交由合并审核 Agent 完成。

安全规则层级：

| 枚举值 | 业务解释 |
| --- | --- |
| `global` | 平台硬规则，正式发布前由平台完成自检。 |
| `organization` | 机构通用规则，作用于机构自有直播间和受邀个人直播间。 |
| `room` | 直播间专项规则。 |

规则层级与归属字段关系：

| `rule_level` | `organization_id` | `room_id` | 业务解释 |
| --- | --- | --- | --- |
| `global` | 空 | 空 | 平台全局硬规则。 |
| `organization` | 有值 | 空 | 某个机构的通用规则。 |
| `room` | 可有值 | 有值 | 某个直播间的个性化规则。 |

安全规则作用域：

| 枚举值 | 业务解释 |
| --- | --- |
| `quick_reply` | 只扫描短回复。 |
| `cue` | 只扫描提词。 |
| `all` | 扫描所有可扫描内容，包括弹幕概要、短回复和提词。 |

安全规则匹配方式：

| 枚举值 | 业务解释 |
| --- | --- |
| `keyword` | 关键词包含匹配，适合单个风险词。 |
| `phrase` | 短语包含匹配，适合禁忌表达和固定话术。 |
| `regex` | 正则匹配，适合复杂模式。 |

安全规则类型：

| 枚举值 | 业务解释 |
| --- | --- |
| `vulgar_content` | 低俗、色情、擦边表达风险。 |
| `insult_attack` | 辱骂、攻击、引战风险。 |
| `discrimination` | 歧视、偏见、群体冒犯风险。 |
| `sensitive_topic` | 违法、高敏或平台敏感话题风险。 |
| `privacy_leak` | 隐私、人肉、联系方式泄露风险。 |
| `platform_forbidden_phrase` | 平台风险词或禁止表达。 |
| `persona_forbidden_phrase` | 主体档案禁忌表达。 |

安全规则表字段：

| 字段名 | 业务解释 |
| --- | --- |
| `rule_id` | 规则唯一 ID。 |
| `rule_level` | 规则层级：`global`、`organization`、`room`。 |
| `organization_id` | 所属机构。 |
| `room_id` | 所属直播间。 |
| `category` | 安全规则类型。 |
| `scope` | 作用域：`quick_reply`、`cue`、`all`。 |
| `match_type` | 匹配方式：`keyword`、`phrase`、`regex`。 |
| `pattern` | 关键词、短语或正则表达式。 |
| `risk_level` | 命中后的风险等级。 |
| `enabled` | 是否启用。 |
| `description` | 规则说明。 |
| `created_at` | 规则创建时间。 |
| `updated_at` | 规则更新时间。 |

平台 global 规则发布前必须完成平台侧校验；存在冲突、歧义或不可应用问题时不允许发布。机构账户收到 global 新版本通知后，应立即整改机构 scope 规则。

个人直播间采用服务端惰性检测：下次开播或启动 AI 服务时，服务端比对该直播间实际适用规则版本。版本不一致才执行冲突检测。检测有冲突时，阻断 AI 生成和 client 推送，但不阻断查看、配置和整改。

`review_stage` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `stage_name` | 固定值 `review`。 |
| `rule_scan` | 程序规则扫描结果。 |
| `agent_name` | 合并审核 Agent 名称。 |
| `agent_result` | 合并审核 Agent 结构化输出。 |
| `attempts` | 合并审核 Agent 每次生成尝试记录。 |
| `error` | 合并审核 Agent 多次失败后的错误信息。 |

`rule_scan` 字段：

| 字段名 | 业务解释 |
| --- | --- |
| `matched` | 是否命中任意规则。 |
| `risk_level` | 规则扫描聚合后的最高风险等级。 |
| `matched_categories` | 命中的风险类型去重列表。 |
| `matched_rule_ids` | 命中的规则 ID 去重列表。 |
| `matched_terms` | 命中的风险词、短语或冲突表达去重列表。 |
| `source_text_refs` | 命中来源去重列表，MVP 只扫描 `quick_reply` 和 `cue`。 |
| `matches` | 每次规则命中的明细列表。 |

MVP 程序规则扫描集中在主播回复内容中，只扫描 `quick_reply` 和 `cue`。如果原始弹幕存在风险，只要生成回复能够避开风险，不直接因为原始弹幕命中风险而拦截。

## client 推送

服务端生成可推送结果后向 active client 推送消息。每条消息必须有唯一 `message_id`。

ACK 策略：

1. client 收到服务端消息后返回 ACK。
2. ACK 只确认 client 已收到，不要求确认浮窗已渲染。
3. 默认 3 秒未 ACK 时重试。
4. 最多重试 2 次。
5. 仍未 ACK 时标记未送达，不做长期补推。
6. client 对重复 `message_id` 幂等处理：重复 ACK，但不重复展示。

浮窗只展示 client 已收到的服务端内容，不直接连接服务端。client 本地配置只保存展示窗口期、字体、主题、透明度、位置、尺寸、锁定、置顶和点击穿透等展示偏好。

client 面向主播使用体验，不展示 Workflow、Agent、模型、规则扫描等底层技术状态。运行中只展示用户可理解状态，例如运行中、连接正常、最近已收到回复和 AI 生成暂时异常。连续 3 轮模型异常时，client 显示非阻断提示“AI 生成暂时异常，正在自动恢复”；单轮模型异常只记录 Workflow `failed`，AI 服务继续运行。

生成 `push` 后如果 ACK 重试仍未收到，记录 `delivered_to_client = false`，不做长期补推。

## 指标

Prometheus / OpenTelemetry 进入 MVP，承担核心运行指标、业务链路指标和标准观测数据暴露。MVP 不提供业务统计 API，不做平台管理端指标页；后续第三方数据门户或观测平台接入 Prometheus / OpenTelemetry 数据。

| 指标 | 业务解释 |
| --- | --- |
| Workflow 次数 | 按触发源、互动类型、推送动作、room_id 统计 Workflow 执行量。 |
| Workflow 延迟 | 统计 Workflow 端到端耗时。 |
| Workflow 失败次数 | 按 stage 统计失败量，定位主链路薄弱环节。 |
| Agent attempt 次数 | 按 Agent、provider、model_id、结果统计模型调用情况。 |
| gRPC 语义分类服务延迟和失败率 | 由主后端记录 lexicon gRPC 调用延迟、失败率和结果。 |
| gRPC 账号权限服务延迟和失败率 | 由主后端记录 auth gRPC 调用延迟、失败率和结果。 |
| client 推送次数 | 按推送状态和 ACK 状态统计 AI 回复到达情况。 |
| provider/model 状态 | 暴露 provider/model 可用状态、失败次数和调用次数；调用次数按 `result=success|failure` 统计。 |

Prometheus label 策略：

1. 允许 `room_id`、`provider` 和 `model_id`。
2. 不允许 `tenant_id`、`user_id`、`comment_id`、`message_id`、弹幕原文、回复正文等高基数或敏感字段。
3. provider/model 冷却剩余时间不暴露为指标。

OpenTelemetry 策略：

1. 通过配置的 OTLP endpoint 导出 trace、metric 和 log。
2. Trace 可以记录 `workflow_id`、`room_id`、`stage`、`provider`、`model_id` 等 ID 类上下文。
3. Trace、log 和结构化日志均不记录弹幕原文、回复正文或 Agent 原始输出。
4. Agent 原始输出只进入 Workflow 持久化。

复杂语义分布、bad case 分析和未送达消息分析优先基于 Workflow 持久化数据完成。
