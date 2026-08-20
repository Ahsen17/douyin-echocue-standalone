# MVP 里程碑计划

本文档描述直播间实时互动助手 MVP 的主路径、阶段交付物、验收标准和依赖关系。MVP roadmap 是从完整 business 业务方案中抽取出的阶段实现计划，目标是用最短链路验证“弹幕进入、互动识别、人设回复、安全判断、client 浮窗展示、服务端 Workflow 回放和核心观测”是否成立。

## 主路径范围

MVP 主路径只覆盖一场直播中的端到端链路：

1. 用户在 client 登录、选择直播间并点击“启动 AI 助手”。
2. 主后端维护 Web / client 登录态、client 会话、active client 锁和最终启动门禁。
3. 主后端通过账号权限微服务获取账号、认证、机构、成员和直播间授权上下文，并执行权限相关判断。
4. 通过 douyinLive WebSocket 服务获取直播间状态和弹幕流；开发和验收优先允许使用同接口模拟弹幕流。
5. 主后端聚合弹幕窗口，并根据内置默认触发参数和冷静期启动 Workflow。
6. 读取当前直播间主体档案 ID 和版本号。
7. 调用稀疏向量语义分类服务，得到本轮弹幕窗口互动类型和 TopN 候选弹幕列表。
8. `InterestAgent` 生成候选弹幕互动评分、选择结果和筛选原因。
9. `ReplyAgent` 生成弹幕原文 / 概要、短回复和提词。
10. 程序安全规则扫描 `quick_reply` 和 `cue`，只检出风险项。
11. 合并审核 Agent 结合规则扫描、回复、主体档案和近期推送记录裁决 `push` / `skip`，并输出结构化原因和审核说明。
12. 服务端将可推送内容发送到 active client，client 展示到浮窗。
13. Workflow 全量持久化到 PostgreSQL，用于审计和回放。
14. 主后端暴露 Prometheus / OpenTelemetry 标准观测数据，用于后续第三方观测平台接入。

MVP 主路径 Agent：

| Agent | 主路径职责 |
| --- | --- |
| `InterestAgent` | 输出候选弹幕评分、选择结果和筛选原因。 |
| `ReplyAgent` | 输出 `comment_display`、`quick_reply`、`cue` 和置信度。 |
| 合并审核 Agent | 结合程序规则扫描、回复内容、主体档案和近期推送记录，输出最终 `push` / `skip`、结构化原因和审核说明。 |

MVP 最终输出：

| 字段名 | 业务解释 |
| --- | --- |
| `comment_display` | 弹幕原文或长弹幕概要。 |
| `quick_reply` | 主播可快速回答的短回复。 |
| `cue` | 方便主播延展讨论的短提词。 |
| `push_action` | 自动审核裁决出的推送动作。 |
| `skip_reason` | 未推送原因。 |
| `review_category` | 结构化审核分类。 |
| `review_note` | 最终审核说明，进入回放。 |

MVP Workflow stage：

| Stage 字段名 | 业务解释 |
| --- | --- |
| `comment_window_stage` | 保存弹幕时间窗口、弹幕总数量、去重用户数等基础窗口信息。 |
| `trigger_evaluation_stage` | 保存触发源判断、阈值计算、冷静期和最终触发结果。 |
| `persona_context_stage` | 保存本轮使用的直播间主体档案 ID 和版本号。 |
| `semantic_classification_stage` | 保存 Workflow batch 语义分类服务的请求与返回结果。 |
| `interest_stage` | 保存候选弹幕评分、Top N、选择结果和筛选原因。 |
| `reply_stage` | 保存 `ReplyAgent` 的输出和重试明细。 |
| `review_stage` | 保存规则扫描、审核判断、推送动作和不推送原因。 |
| `client_delivery_stage` | 保存向 active client 推送、ACK 和重试结果。 |

## M1 基础工程与数据底座

目标：搭建后端基础工程、数据库、Redis、Qdrant 和本地开发运行环境。

交付物：

1. Docker Compose 基础编排，沿用现有 `postgres`、`redis`、`qdrant`、`live`、`lexicon`、`app` 服务。
2. Python + Litestar 主后端服务骨架。
3. PostgreSQL 服务和数据库连接配置。
4. Redis 服务和运行态会话 / 锁存储配置。
5. Qdrant 服务和基础连接配置。
6. 基础配置加载机制。
7. 初始数据库迁移结构。
8. 本地开发启动说明。

验收标准：

1. 可以通过 Docker Compose 启动主后端、PostgreSQL、Redis 和 Qdrant。
2. 主后端健康检查接口可访问。
3. 服务可以读取基础配置。
4. 数据库迁移可以执行成功。
5. Redis 健康检查可用，主后端可以建立连接。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| Python 工程骨架 | 后续 Workflow、API、Agent 模板加载和微服务 CLI 都依赖主后端工程。 |
| PostgreSQL | 后续主体档案、触发配置、安全规则、账号权限数据和 Workflow 审计都依赖数据库。 |
| Redis | 后续 client 会话、active client 分布式锁、心跳状态和模型 provider 运行状态依赖 Redis。 |
| Qdrant | 后续稀疏向量语义分类依赖 Qdrant。 |

## M2 弹幕模拟与语义分类

目标：跑通直播状态、弹幕输入、弹幕窗口和互动类型分类。

交付物：

1. douyinLive WebSocket 弹幕源适配，开发验收优先支持同接口模拟弹幕流。
2. `live_status` 开播 / 下播状态维护。
3. 弹幕事件规范化结构。
4. 直播间级弹幕窗口聚合。
5. 稀疏向量语义分类服务，作为独立 `lexicon` 容器和独立 `src/aigc/core/lexicon/` 模块运行。
6. 互动价值样本 JSONL。
7. Qdrant collection 初始化和全量重建命令。
8. 主后端到语义分类服务的 gRPC 调用。
9. 语义分类服务标准 `.proto` 文件和生成后的 Python gRPC 代码，保存于 `src/aigc/core/lexicon/proto/`。
10. 现有手写 bytes + JSON gRPC 编码迁移为标准 `.proto` 生成代码。
11. 文档记录每个 `.proto` 路径、手动 `grpc_tools` 生成命令和生成文件位置。

验收标准：

1. 主后端可以通过 douyinLive WebSocket 或同接口模拟流持续读取直播状态和弹幕事件。
2. 主后端可以根据 `ROOM_ONLINE`、`ROOM_ENDED`、`ROOM_OFFLINE` 维护直播间状态。
3. 主后端可以规范化弹幕事件并形成窗口。
4. 语义分类服务可以基于互动样本构建 Qdrant 索引。
5. 主后端可以通过 gRPC 获取窗口级互动类型和置信度。
6. 主后端可以获取 TopN 候选弹幕列表，TopN 默认 5，允许范围 1-10。
7. 无可靠分类时返回 `other`，MVP 固定阈值为 `confidence < 0.55`。
8. `lexicon` 的 gRPC 接口使用标准 `.proto` 生成代码完成服务端和客户端通信。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M1 数据库、Redis、Qdrant 和服务骨架 | 弹幕接收、窗口聚合、服务配置和样本召回依赖基础能力。 |
| Qdrant | 稀疏向量样本召回依赖 Qdrant。 |

## M3 Workflow 主链路

目标：完成从弹幕窗口到互动回复结果的核心 Workflow。M3 只实现内部 Workflow 主链路，不做登录、权限、active client 锁和启动门禁。

交付物：

1. Workflow 触发判断。
2. 内置默认触发参数读取。
3. 冷静期控制。
4. 直播间主体档案版本读取。
5. `InterestAgent` 模板和调用逻辑。
6. `ReplyAgent` 模板和调用逻辑。
7. 合并审核 Agent 模板和调用逻辑。
8. Agent 输出 Pydantic 校验和 attempts 重试机制。
9. 程序安全规则扫描。
10. 结构化 `skip_reason`、`review_category` 和 `review_note`。
11. `workflow_runs` 单表宽 JSONB 持久化。
12. 平台模型 provider 配置读取、当前 provider/model 选择和 Redis 运行状态记录。

验收标准：

1. 一轮 Workflow 可以由弹幕窗口或高价值弹幕触发。
2. Workflow 可以生成候选评分、短回复和提词。
3. 冷静期内不重复推送，窗口继续滚动刷新。
4. 程序规则扫描命中风险项后不直接裁决，可将风险项交给合并审核 Agent 生成 `push_action`、`skip_reason`、`review_category` 和 `review_note`。
5. Workflow 全局状态可以正确落库。
6. 各 stage JSONB 字段可以保存本轮结构化记录。
7. Agent 输出校验失败时可以按 attempts 机制重试。
8. `push` 和 `skip` 正常跑完均记录为 `completed`，系统异常记录为 `failed`。
9. Agent 只关注 attempts，不感知 provider 切换策略。
10. 同一个 `provider + model_id` 在 1 分钟内连续 5 次模型调用失败时，平台运行状态将该 model 标记为不可用 5 分钟，并按配置顺序先轮询同 provider 内其他 model，再轮询下一个 provider。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M2 弹幕窗口和互动分类 | Workflow 触发和 Interest 输入依赖弹幕窗口与互动类型。 |
| 主体档案数据 | Reply 生成依赖直播间主体档案版本。 |
| 平台模型配置 | Agent 调用依赖平台维护的 OpenAI-compatible provider 配置。 |
| Redis | 模型 provider/model 可用状态、失败计数和当前选择依赖 Redis。 |

## M4 账号权限微服务

目标：完成独立账号权限微服务，并让主后端可以通过 gRPC 获取账号权限上下文和权限判断结果。

交付物：

1. 新增 Compose 服务 `auth`，使用同一个 PostgreSQL 实例和独立数据表组织。
2. 账号权限微服务基于当前已有的 `src/aigc/auth/` 模块做业务增强，参考现有 `lexicon` 微服务补充独立服务入口、gRPC 边界、proto、迁移和测试组织，不新增第二个 auth 业务模块。
3. CLI 启动命令 `uv run app auth serve`。
4. 默认 gRPC 端口 `50052`，运行时优先读取配置。
5. `auth` 配置块，字段风格参考 `lexicon`：`grpc_enabled`、`grpc_target`、`grpc_timeout`、`grpc_host`、`grpc_port`。
6. 独立迁移目录和账号权限服务初始化 / 种子数据命令。
7. 标准 `.proto` 文件和生成后的 Python gRPC 代码。
8. 文档记录 `.proto` 路径、手动 `grpc_tools` 生成命令和生成文件位置。
9. 账号、凭据校验、认证状态、机构、成员、直播间、直播间授权数据管理接口。
10. 权限上下文聚合接口，返回账户、认证、机构、成员和直播间授权信息。
11. 权限判断接口，覆盖 Web 页面 / 操作鉴权和 client 启动前权限校验。
12. 主后端 gRPC 客户端集成。

验收标准：

1. Docker Compose 可以启动 `auth` 服务，主后端可以通过 gRPC 调用。
2. 账号权限微服务使用标准 `.proto` 生成代码完成通信。
3. 微服务可以校验账号凭据，主后端成功后签发自身 Web / client 登录态。
4. 微服务可以管理未认证、个人认证和机构认证状态。
5. 个人认证账号只能绑定并管理一个自有直播间。
6. 机构认证账号可以管理成员、多个机构自有直播间，并按直播间授权成员。
7. 受邀个人直播间在机构下可被机构查看基础状态和回放，但机构不能修改该个人直播间配置。
8. 主后端可以一次性获取完整权限上下文，也可以调用权限判断接口。
9. 账号权限微服务不维护 Web / client 登录态、client 会话、active client 锁或最终启动门禁。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M1 PostgreSQL、已有 auth 模块和服务骨架 | 账号权限数据持久化、迁移和独立服务入口依赖基础工程与现有 `src/aigc/auth/`。 |
| M1 Redis | 主后端后续维护 client 会话和 active client 锁依赖 Redis。 |
| 主后端 | Web 和 client 均只访问主后端，主后端再调用账号权限微服务。 |

## M5 Web 管理端主功能

目标：让用户能够配置主路径所需数据，并查看 Workflow 结果。Web 前端构建为静态文件后由主后端托管，不新增独立 Web 容器。

交付物：

1. Web 管理端前端 UI。
2. Web 登录入口，主后端维护登录态并调用账号权限微服务校验凭据。
3. 开户认证状态管理。
4. 机构成员和直播间权限管理。
5. 当前账户和直播间上下文。
6. 直播间主体档案编辑、发布和版本查询。
7. 触发配置编辑页面。
8. 安全规则编辑页面，支持 global、organization、room 三层规则。
9. Workflow 历史列表。
10. Workflow 详情页。
11. 互动回复结果、推送状态和不推送原因展示。
12. 普通用户业务摘要和平台管理员技术详情的分层展示。
13. 平台管理员只读查看 provider/model 状态，数据来自 Redis。

验收标准：

1. 用户可以登录管理端。
2. 用户可以维护直播间主体档案。
3. 用户可以编辑直播间级触发配置。
4. 用户可以按权限编辑机构级和直播间级安全规则。
5. 用户可以按直播间、时间范围、触发源、互动类型和推送动作查看 Workflow 历史。
6. 管理端可以展示 `comment_display`、`quick_reply`、`cue`、`push_action` 和 `skip_reason`。
7. Workflow 详情页可以展示窗口、触发、主体档案、语义分类、候选评分、回复、审核和推送各 stage 摘要。
8. 平台管理员技术详情隐藏 API Key、连接串、内部路径和密钥类配置。
9. 普通用户看不到 Workflow、Agent、模型、规则扫描等底层技术状态。
10. 普通用户在 Web 管理端不展示模型异常信息；模型异常主要由 client 做业务化提示。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M1 数据库 | 管理端配置和查询依赖数据库表结构。 |
| M3 Workflow 持久化 | Workflow 历史和详情依赖 `workflow_runs` 数据。 |
| M4 账号权限微服务 | Web 登录、认证、机构成员和直播间权限依赖账号权限微服务。 |

## M6 Windows client 与浮窗联调

目标：完成主播端 Electron client、浮窗展示和主后端推送联调。Windows client 单独打包运行，不进入 Docker Compose。

交付物：

1. Electron client 应用。
2. client 登录、单用户单 client 会话和心跳。
3. client 与主后端 WebSocket 连接。
4. Redis active client 分布式锁和同直播间单 client 约束。
5. 浮窗展示弹幕原文 / 概要、短回复和提词。
6. 置顶、半透明、拖拽、点击穿透。
7. 一键隐藏 / 显示。
8. 字号调节。
9. 明暗主题。
10. client 本地展示配置。
11. 中等窗口、水平居中、垂直靠下、毛玻璃透明度 60%、文字不透明、字号 20、暗色主题、置顶开启、点击穿透开启的默认配置。
12. 启动失败的可理解原因展示、Web 整改入口和“我已调整”后重新检查并自动启动。

验收标准：

1. client 可以登录并连接主后端。
2. 同一用户同一时间只能登录一个 client。
3. 同一直播间同一时间只有一个 active client。
4. client 每 10 秒心跳，服务端使用 Redis 分布式锁心跳续租和 TTL 自动释放；30 秒无心跳后停止服务并释放锁。
5. `push` 结果可以实时送达 client 并展示到浮窗。
6. `skip` 结果不会展示为主播话术。
7. client 可以 ACK AI 回复消息；3 秒未 ACK 时重试，最多 2 次，不做长期补推。
8. 浮窗基础交互可用。
9. 新消息到达时直接覆盖当前消息。
10. client 只展示用户可理解状态，不展示 Workflow、Agent、模型、规则扫描等底层技术状态。
11. 下播自动停止时，client 以 Toast 提示“直播已结束，AI 助手已停止”。
12. 心跳断线恢复后，client 提示“连接中断，AI 助手已停止”，并提供重新启动按钮。
13. 被其他 client 接管时，当前 client 停止 AI 服务并提示“该直播间已在其他设备启动”。
14. 连续 3 轮 AI 生成失败时，client 显示非阻断提示“AI 生成暂时异常，正在自动恢复”。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M3 Workflow 输出 | client 展示依赖 `comment_display`、`quick_reply`、`cue` 和 `push_action`。 |
| M4 账号权限微服务 | client 登录、直播间权限上下文和启动权限判断依赖账号权限能力。 |
| M5 管理端 | 管理端用于配置、整改和查看回放。 |
| Redis | client 会话、心跳状态和 active client 分布式锁依赖 Redis。 |

## M7 Prometheus / OpenTelemetry 观测

目标：补齐 MVP 核心运行指标和业务链路观测。M7 只提供标准 Prometheus / OpenTelemetry 暴露能力，不提供业务统计 API，不做平台管理端指标页；后续第三方数据门户或观测平台接入这些标准数据。

交付物：

1. 主后端 `/metrics` Prometheus endpoint。
2. OTLP endpoint 配置，支持将 trace、metric、log 导出到配置中的 OTLP Collector。
3. Workflow 次数、延迟和失败指标。
4. Agent attempts 指标。
5. lexicon / auth gRPC 调用延迟、失败率和结果指标，由主后端记录外部调用侧指标。
6. client 推送、ACK、未送达指标。
7. 模型 provider/model 可用状态、失败次数和调用次数指标。
8. OTel trace 业务上下文埋点。
9. 结构化日志规范，禁止记录 Agent 原始输出。

验收标准：

1. 主后端可以暴露 `/metrics`，Prometheus 可以拉取指标。
2. OTel 可以通过配置的 OTLP endpoint 导出 trace、metric 和 log。
3. Workflow 指标按触发源、互动类型、推送动作和 stage 统计。
4. Agent attempts 指标按 Agent、provider、model_id 和结果统计。
5. lexicon / auth gRPC 指标按服务名、方法和结果统计。
6. client 推送指标按推送状态和 ACK 状态统计。
7. provider/model 指标暴露可用状态、失败次数和调用次数；调用次数按 `result=success|failure` 统计，不暴露冷却剩余时间。
8. Prometheus label 允许 `room_id`、`provider` 和 `model_id`；不允许 `tenant_id`、`user_id`、`comment_id`、`message_id`、弹幕原文、回复正文等高基数或敏感字段。
9. OTel trace 可以记录 `workflow_id`、`room_id`、`stage`、`provider`、`model_id` 等 ID 类上下文，不记录弹幕原文、回复正文或 Agent 原始输出。
10. OTel log / 结构化日志不记录 Agent 原始输出，只记录摘要、错误类型和必要定位字段。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M3 Workflow | Workflow、Agent 和模型调用指标依赖主链路结构。 |
| M4 账号权限微服务 | auth gRPC 调用指标依赖账号权限服务集成。 |
| M6 client | client 推送和 ACK 指标依赖 client 联调完成。 |

## M8 端到端验收

目标：完成本地环境下的完整 MVP 演示和验收。

交付物：

1. 端到端演示脚本。
2. 演示用弹幕样本。
3. 演示用账号、认证、机构、成员和直播间授权数据。
4. 演示用主体档案。
5. 演示用安全规则。
6. 验收 checklist。
7. 已知问题记录。

验收标准：

1. Docker Compose 可以启动 `postgres`、`redis`、`qdrant`、`live`、`lexicon`、`auth` 和 `app`。
2. douyinLive 或同接口模拟弹幕流可以持续推送状态和弹幕。
3. Web 管理端可以完成登录、认证状态查看、权限管理、主体档案配置、安全规则配置、历史和结果查看。
4. 账号权限微服务参与登录、认证状态、直播间授权和启动门禁验收。
5. Workflow 可以自动触发并生成短回复和提词。
6. 安全命中时可以正确生成不推送原因。
7. Windows client 可以接收并显示可推送内容。
8. PostgreSQL 中可以回溯完整 Workflow 记录。
9. Prometheus / OpenTelemetry 可以采集 MVP 核心运行指标和链路数据。

依赖关系：

| 依赖项 | 说明 |
| --- | --- |
| M1-M7 | 端到端验收依赖前置里程碑全部完成。 |

## 高风险后置项

MVP roadmap 只列会影响验收预期的高风险后置项。其他后置能力应在完整 business 正式文档或技术债务文档中体现。

| 后置项 | 处理方式 |
| --- | --- |
| OBS 捕捉排除 | 不进入 MVP roadmap，不作为 MVP 验收项；作为 Windows client 后续专项能力在完整业务文档或技术债务中维护。 |
