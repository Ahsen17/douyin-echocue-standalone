# Echocue 文档体系审查报告 v0.1

> 审查方式：两名隔离只读审查 agent；主 agent 依据结论修订后进行短复核。  
> 审查范围：`docs/01` 至 `docs/06`。

## 1. 最终结论

文档体系的主要设计冲突已修订关闭；当前不存在文档层面的 P0 或 P1 阻塞项。仍有一个**外部 P0 release gate**：真实抖音普通弹幕接入 POC 尚未执行，故完整 MVP 不能被标记为可验收。

## 2. 已关闭的关键问题

| 原问题 | 处置 |
| --- | --- |
| 审计状态允许跳步、无法证明完整回放 | 在数据契约中固定状态枚举、允许迁移表、`AuditStoreWorker` 单事务校验和必需快照矩阵。 |
| 人设版本可错误关联 | 增加复合版本关系、发布/父版本 trigger，并约束只加载已发布版本。 |
| AES-GCM 字段无法统一解密 | 所有敏感值改为 canonical envelope BLOB；固定 tag、AAD、密钥版本与 HMAC 规则。 |
| 打标回流存在双事实来源 | 定义 transactional outbox；job 是唯一同步事实，反馈状态由 job 派生。 |
| `bad_case` 可能污染通用 `pre_set` | `pre_set` 运行期只读；仅被直接展示的 golden point 可标坏。 |
| 两个 Qdrant collection 的分数不可比 | 固定双路检索、版本化 calibration、归一化置信度与审计字段。 |
| 稀疏检索被错误改为 TF-IDF | 已恢复既定 jieba-BM25：`jieba-wasm.cut_for_search` 生成中文词表，客户端写入 BM25 文档侧权重，Qdrant `modifier.IDF` 在查询时维护并计算 IDF；查询 token 权重固定为 1。 |
| 展示期弹幕无审计 | 展示期仍创建 `RECEIVED → NORMALIZED → DISCARDED` 审计链，原因 `DISPLAY_WINDOW_ACTIVE`。 |
| golden 直出绕过当前禁忌 | 直出与 LLM 输出均通过同一个当前人设/禁忌/安全校验器。 |
| 浮窗可能取得高权限 IPC | 主窗口与浮窗使用不同 preload，Main 校验 sender、窗口类型和受信任 URL。 |
| 托盘/图标未纳入打包测试 | Windows x64 POC 验收加入 SVG 转换、托盘关闭/恢复、显式退出、sidecar 停止和审计 flush。 |

## 3. 唯一未关闭的 release gate

| 等级 | 事项 | 解除条件 |
| --- | --- | --- |
| P0（外部验证） | `jwwsjlm/douyinLive` 真实普通弹幕接入。 | 在 Windows x64 安装包、甲方授权真实开播房间连续运行 30 分钟；归档事件/重复率/断连/到达时间；验证 `ROOM_OFFLINE`/`ROOM_ENDED` 立即关 WS；确认凭证不进入日志。未完成前，不得宣称 MVP 端到端可验收。 |

## 4. 审查后文档状态

- 需求、PRD、调研、架构、初始案例标准与数据/接口契约在 standalone、双 collection、版本人设、审计、托盘和时延目标上已对齐。
- 用户仍需在 POC 前提供首批 `pre_set` 数据、DeepSeek 配置及真实测试直播间；这不是文档缺陷。
- 后续进入测试计划与研发任务拆分时，应把本报告第 3 节作为 release gate 写入验收清单。
