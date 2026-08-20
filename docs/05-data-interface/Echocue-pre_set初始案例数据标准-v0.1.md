# Echocue `pre_set` 初始案例数据标准 v0.1

> 提供方：甲方  
> 用途：初始化通用 Qdrant `pre_set` 相似案例库；仅作检索参考与 LLM 上下文，不可直接推送浮窗。

## 1. 交付格式

- 文件名：`echocue-pre-set-v1.jsonl`
- 编码：UTF-8（无 BOM）
- 格式：JSON Lines；每行一个完整 JSON 对象；不得含注释、数组外壳或空行。
- `id` 必须稳定且全局唯一。同一案例更新时保留同一 `id`，由客户端做幂等 upsert。
- 该 JSONL 只是甲方向客户端交付的**初始导入包**，客户端首次初始化时写入 `pre_set`；它不是运行期回流机制，不会触发 collection 全量重建。

## 2. 单条案例 Schema

```json
{
  "schema_version": "1.0",
  "id": "pre-000001",
  "text": "今天状态真好，太有活力了",
  "semantic_type": "positive_praise",
  "description": "对主播状态和精神面貌的正面夸赞，可自然接话",
  "reference_reply": "谢谢你，今天确实元气在线！",
  "reference_cues": ["自然接住夸奖", "引导大家继续互动"],
  "tags": ["正面", "夸赞", "氛围"],
  "enabled": true,
  "is_bad_case": false
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `schema_version` | 是 | 当前固定为 `"1.0"`。 |
| `id` | 是 | 字符串；建议 `pre-` 前缀；稳定唯一。 |
| `text` | 是 | 原始或脱敏后的典型弹幕，不得含真实个人信息、联系方式、账号凭证或攻击性内容。 |
| `semantic_type` | 是 | 见第 3 节枚举。 |
| `description` | 是 | 自然语言描述该案例的互动价值、语境或筛选理由。 |
| `reference_reply` | 否 | 供 LLM 参考的短回复；`pre_set` 即使包含它也不可直接展示。 |
| `reference_cues` | 否 | 字符串数组，最多 3 条、每条不超过 40 个汉字。 |
| `tags` | 否 | 字符串数组，用于人工整理；不作为人设路由依据。 |
| `enabled` | 是 | 初始建议均为 `true`；设为 `false` 的案例不会被召回。 |
| `is_bad_case` | 是 | 初始必须为 `false`；`pre_set` 在运行期只读，不因主播对某次 AI 建议的拒绝而被修改。 |

## 3. `semantic_type` 枚举

建议优先使用以下值；如确需新增，先与乙方确认并更新 schema：

| 值 | 含义 |
| --- | --- |
| `persona_relevant` | 与主播人设、状态、风格直接相关的正面互动。 |
| `positive_praise` | 夸赞外形、状态、表达或表现。 |
| `funny_joke` | 有梗、反差、可自然接住的玩笑。 |
| `interactive_question` | 适合即时回应并延展的话题或提问。 |
| `atmosphere_boost` | 能带动直播气氛的正面内容。 |
| `low_value` | 安全但互动价值低，用于初筛参考。 |
| `filter_risk` | 明确不应进入生成链路的风险/禁忌类示例；正文必须脱敏。 |

## 4. 示例

```json
{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好，太有活力了","semantic_type":"positive_praise","description":"对主播状态的正面夸赞","reference_reply":"谢谢你，今天确实元气在线！","reference_cues":["自然接住夸奖","带动互动"],"tags":["正面","夸赞"],"enabled":true,"is_bad_case":false}
{"schema_version":"1.0","id":"pre-000002","text":"这反应也太快了吧，笑死我了","semantic_type":"funny_joke","description":"针对即时反应的轻松玩笑","reference_reply":"你们别夸，我一会儿就要骄傲了。","reference_cues":["轻松自嘲","接住笑点"],"tags":["玩笑","互动"],"enabled":true,"is_bad_case":false}
```

## 5. 甲方准备原则

1. POC 首批建议提供 30–50 条真实或已脱敏典型弹幕，覆盖第 3 节的主要类别；随后可持续补充。
2. 不要为不同成员复制同一案例；`pre_set` 是通用库。与特定成员、人设版本强绑定的优质回复会由系统从审计打标中进入 `golden_set`。
3. `reference_reply` 应是可供模型借鉴的表达，不应包含固定人名、敏感交易信息、个人信息或会过期的事实。
4. `filter_risk` 只保留最少可识别的脱敏文本；硬规则仍是安全过滤的第一道防线，案例库不替代安全规则。
5. 甲方交付前应人工确认 `text`、`description`、参考回复均允许在本机永久审计和检索使用。

## 6. 导入后行为

客户端将 `text` 经 regex 清理、Unicode 标准化、`jieba-wasm.cut_for_search` 分词后生成文档侧 BM25 稀疏向量，写入 `pre_set`，并保存上述字段为 payload；collection 开启 Qdrant `modifier.IDF`。运行时只查询 `enabled=true AND is_bad_case=false` 的通用案例；返回的 `reference_reply`/`reference_cues` 只作为 LLM 上下文，永不直接触发浮窗。`pre_set` 运行期只读；`golden_set` 不由本文件提供，而由用户在审计工作区的打标结果自动维护。
