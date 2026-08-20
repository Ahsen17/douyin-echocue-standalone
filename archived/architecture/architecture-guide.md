# 架构指导

## 部署形态

MVP 后端服务使用 Docker Compose 启动。Windows client 单独打包运行，浮窗由 client 管理。

初始容器包括：

- 主后端服务。
- 弹幕模拟 / douyinLive 服务。
- 稀疏向量语义分类服务。
- 账号权限微服务。
- PostgreSQL。
- Redis。
- Qdrant。

前端与桌面端：

- Web 管理端：React + Vite，构建为静态文件后由主后端托管，不作为独立 Compose 容器。
- Windows client：Electron。
- Windows 浮窗：client 管理的展示窗口，Electron。

MVP Compose 沿用当前服务拓扑并新增账号权限微服务：

| 服务名 | 业务解释 |
| --- | --- |
| `postgres` | 主业务数据、Workflow、主体档案、安全规则和账号权限数据共用的 PostgreSQL 实例。 |
| `redis` | client 会话、active client 分布式锁、心跳状态和模型 provider 运行状态。 |
| `qdrant` | 语义分类稀疏向量召回存储。 |
| `live` | douyinLive WebSocket 服务或同接口弹幕模拟服务。 |
| `lexicon` | 独立稀疏向量语义分类 gRPC 微服务。 |
| `auth` | 独立账号权限 gRPC 微服务。 |
| `app` | Python + Litestar 主后端服务。 |

## 主后端

使用 Python + Litestar。

职责：

- Web 管理端 HTTP API。
- client WebSocket 推送通道。
- Workflow 编排。
- 直播间主体档案管理。
- 安全规则与触发配置管理。
- Web / client 登录态维护。
- client 会话、心跳和 active client 分布式锁管理。
- 调用账号权限微服务获取账号权限上下文和权限判断结果。
- 平台模型 provider 配置读取、运行状态维护和自动轮询切换。
- Workflow 全量持久化。
- Prometheus / OpenTelemetry 指标。

主后端是 Web 和 client 的唯一访问入口。Web 和 client 不直接访问 `lexicon` 或 `auth` 微服务。

## 弹幕模拟与 douyinLive

开发阶段从预设文件读取弹幕，并按时间顺序模拟推送。MVP 可接入 douyinLive WebSocket 服务读取直播状态和实时事件。

模拟层需要贴近后续官方接口形态：

- HTTP 用于控制操作。
- WebSocket 用于实时直播事件流。

直播事件使用统一外层结构，并可保留类平台原始字段，便于后续映射官方接口。

douyinLive WebSocket 同时提供：

| 事件 | 业务解释 |
| --- | --- |
| `live_status` | 系统事件，用于维护直播间开播 / 下播状态。 |
| `WebcastChatMessage` | 弹幕消息，进入窗口聚合和互动识别链路。 |
| `WebcastGiftMessage` | 礼物消息，MVP 可先保留为原始事件。 |
| `WebcastLikeMessage` | 点赞消息，MVP 可作为后续排序信号。 |

`live_status` 主要状态：

| code | 处理策略 |
| --- | --- |
| `ROOM_ONLINE` | 直播间已开播，可以进入 AI 服务启动门禁。 |
| `ROOM_ENDED` | 直播间已下播，应停止对应直播间 AI 服务。 |
| `ROOM_OFFLINE` | 直播间未开播，启动流程阻断。 |

douyinLive 没有独立直播状态查询接口。启动时通过连接 WebSocket 并读取首个 `live_status` 判断是否开播；若首个状态为 `ROOM_OFFLINE`，本次启动失败并断开连接。运行中收到 `ROOM_ENDED` 时，服务端停止该直播间 AI 服务，client 关闭浮窗。

## AI 服务商模型

AI 交互协议只支持 OpenAI-compatible API。

平台通过配置文件维护多个模型 provider 和每个 provider 下的 model_id 列表。模型配置对普通用户不可见，属于平台职责。

| 配置项 | 业务解释 |
| --- | --- |
| 服务商名称 | 服务端内部引用的 provider 名称。 |
| Base URL | OpenAI-compatible API 的访问地址。 |
| API Key | 调用模型服务所需的认证密钥。 |
| Model ID 列表 | 当前 provider 下可轮询使用的模型标识。 |
| Timeout | 单次模型调用超时时间。 |
| Temperature | 控制生成随机性的模型参数。 |
| Max tokens | 限制单次生成的最大输出长度。 |

运行时 provider/model 可用状态、失败次数、调用次数和当前选择记录在 Redis。自动切换策略为：

1. Agent 只按平台当前指定的 provider/model 执行 attempts，不感知 provider 切换。
2. 单个 Agent attempts 全失败后，当前 Workflow 向上返回失败信息。
3. 平台按 `provider + model_id` 在 Redis 中做全局滑动窗口统计。
4. 同一 `provider + model_id` 在 1 分钟内连续出现 5 次模型调用失败时，标记该 model 暂不可用。
5. 不可用冷却时间默认为 5 分钟；冷却到期后重新进入可尝试候选。
6. 自动选择时优先在同一个 provider 内按配置顺序轮询可用 model_id；当前 provider 下所有 model 都不可用时，再轮询下一个 provider。
7. 已经开始的 Agent 调用不强制中断；后续新调用避开不可用 model。

平台管理员可在 Web 管理端只读查看 provider/model 状态；不提供人工切换入口。

Agent 实例通过项目自定义 `load_from_template` 流程创建。

模板格式：

| 模板区域 | 业务解释 |
| --- | --- |
| YAML frontmatter | 保存 Agent 运行配置，例如 provider、model_id、temperature、timeout、retry。 |
| Jinja body | 保存 instructions / system prompt，并在运行时注入业务上下文和 JSON Schema。 |

输出 schema 由服务端代码中的 Pydantic 数据结构控制。运行时基于 Pydantic 生成 JSON Schema，注入 Jinja 渲染上下文，并在模型返回后执行 Pydantic 校验。

## AutoGen

MVP 使用 AutoGen AgentChat + GraphFlow 做 Workflow 和多 Agent 编排。

程序逻辑负责确定性任务：

- 弹幕窗口聚合。
- 去重。
- 触发策略判断。
- 冷静期控制。
- 主体档案版本读取。
- 硬规则扫描。
- 输出校验和持久化。
- client 推送和 ACK 记录。

Agent 只处理语义任务：

| Agent | 职责 |
| --- | --- |
| `InterestAgent` | 判断候选弹幕的互动价值、趣味类型和评分原因。 |
| `ReplyAgent` | 生成主播可以直接使用的短回复和提词。 |
| 合并审核 Agent | 结合程序规则扫描、回复内容、主体档案和近期推送记录，执行最终 `push` / `skip` 裁决并输出结构化原因。 |

启动门禁不把模型配置作为用户侧整改项。模型服务由平台保障；异常时按平台服务异常处理。

client 不展示 Workflow、Agent、模型、规则扫描等底层技术状态。平台管理员可在 Web 管理端技术详情中查看必要排障信息，但 API Key、连接串、内部路径和密钥类配置必须隐藏。

## gRPC 接口规范

MVP 微服务间 gRPC 接口使用标准 `.proto` 文件生成 Python 代码，不再使用手写 bytes + JSON 编码。

`.proto` 文件按服务放在各自模块下，例如：

- `src/echocue/core/lexicon/proto/`
- `src/echocue/auth/proto/`

生成后的 Python gRPC 代码提交到仓库。MVP 不新增统一生成命令，采用手动 `grpc_tools` 命令生成；文档需要记录每个服务的 `.proto` 路径、生成命令和生成文件位置。

## 语义分类服务

弹幕语义分类仍独立为 gRPC 微服务，由主后端 Workflow 调用。lexicon 是独立微服务模块，代码组织在 `src/echocue/core/lexicon/`，与 `src/echocue/core/live/` 平级；`core/live` 只负责直播事件、直播状态和弹幕窗口聚合。

服务内部使用：

- 文本标准化。
- Regex 清洗。
- Unicode 标准化。
- Jieba 分词。
- 停用词过滤。
- BM25 权重。
- 稀疏向量。
- Qdrant 稀疏向量存储与召回。
- TopK 投票得到窗口级主互动类型和候选弹幕列表。

语义样本使用 JSONL，字段保持极简：

```json
{"id":"playful_joke_000001","semantic_type":"playful_joke","text":"主播这波操作像开了倍速","description":"有梗、调侃、适合主播接话的弹幕。"}
```

Qdrant 保存当前有效索引。样本文件更新后，清空 Qdrant collection，并基于最新 JSONL 全量重建。

公开 gRPC API 提供 Workflow batch 分类接口。服务内部保留单条分类函数，用于测试和调试；运行主链路不逐条调用大模型判断互动价值。

分类服务输出窗口级主互动类型和 TopN 候选弹幕列表。TopN 默认 5，允许范围 1-10。最高候选类型置信度低于 0.55 时返回 `other`。

请求保持极简：

```json
{
  "room_id": "live_room_id",
  "text_batch": ["主播晚上好", "这句话太像你风格了"]
}
```

响应保持极简：

```json
{
  "semantic_type": "persona_praise",
  "confidence": 1.0,
  "top_n": 5,
  "candidates": [
    {
      "comment_id": "comment_id",
      "text": "这句话太像你风格了",
      "semantic_type": "persona_praise",
      "score": 1.0,
      "confidence": 1.0
    }
  ]
}
```

兜底语义类型为 `other`。

分类服务配置参考当前 `lexicon` 配置块：

```yaml
lexicon:
  grpc_enabled: true
  grpc_target: "lexicon:50051"
  grpc_timeout: 1.0
  grpc_host: "0.0.0.0"
  grpc_port: 50051
  collection_name: "live_lexicon"
```

## 账号权限微服务

账号权限微服务作为独立 `auth` 容器运行，由主后端通过 gRPC 调用。它只负责账号、认证、机构、成员、直播间授权的数据管理和权限逻辑判断；不维护 Web / client 登录态、client 会话、active client 锁或最终启动门禁。

账号权限管理基于当前已有的 `src/echocue/auth/` 模块进行业务增强，不新增第二个 auth 业务模块。账号权限微服务代码组织参考 `lexicon` 微服务：同仓、基于现有 `auth/` 包补充独立服务入口、gRPC 边界、proto、迁移和测试组织。CLI 启动命令为：

```bash
uv run app auth serve
```

账号权限数据使用同一个 Compose 中的 PostgreSQL 实例，表结构按账号权限服务边界独立组织；代码 schema 和数据模型在现有 `src/echocue/auth/` 包内按账号权限服务职责扩展。

默认 gRPC 端口为 `50052`，运行时优先读取配置。配置字段风格参考 `lexicon`：

```yaml
auth:
  grpc_enabled: true
  grpc_target: "auth:50052"
  grpc_timeout: 1.0
  grpc_host: "0.0.0.0"
  grpc_port: 50052
```

账号权限微服务提供：

| 能力 | 业务解释 |
| --- | --- |
| 凭据校验 | 主后端接收登录请求后调用微服务校验账号凭据，成功后由主后端签发自身 session/token。 |
| 数据管理 | 管理账户、认证、机构、成员、直播间和直播间授权。 |
| 权限上下文聚合 | 一次返回账户、认证、机构、成员和直播间授权上下文。 |
| 权限判断 | 判断用户是否可查看/编辑某直播间配置、规则、回放，或是否具备启动某直播间 AI 助手的权限。 |
| 初始化数据 | 提供种子数据或初始化命令，支持本地开发、自动测试和 MVP 演示。 |

认证状态按未认证、个人认证、机构认证区分。个人认证账号只能绑定并管理一个自有直播间；机构认证账号可管理成员、多个机构自有直播间，并按直播间授权成员。受邀个人直播间在机构下可被机构查看基础状态和回放，但机构不能修改该个人直播间配置。
