# Echocue Qdrant + jieba-BM25 POC 记录模板 v0.1

> 状态：待执行模板，不是已通过的 POC 证据
> 目的：在冻结 `Bm25ZhJiebaProfileV1`、置信度校准和直出阈值前，形成可复现的中文检索证据。

## 1. 运行环境与输入

| 项目 | 实际值 |
| --- | --- |
| Windows 版本 / CPU / 内存 | 待填 |
| Qdrant 版本、二进制 SHA-256 | 待填 |
| `jieba-wasm` 版本、词典 SHA-256 | 待填 |
| `murmurhash3js-revisited` / Python `mmh3` 版本 | 待填 |
| `pre_set` schema/version/有效条数/文件 SHA-256 | 待填 |
| golden 样本条数与脱敏规则 | 待填 |
| regex、NFKC、同义/热词规则版本 | 待填 |
| `k1` / `b` 初始值 | `1.2` / `0.75`，须以结果确认或替换 |

## 2. 跨语言 token index fixture

对每个 token 使用 UTF-8 bytes、MurmurHash3 x86 32-bit、seed 0，转换为 signed int32 后取绝对值。TS 与 Python 结果必须逐项相同；发现同文档碰撞必须记录，禁止静默换算法。

| token | UTF-8 hex | TS index | Python index | 相同 | 备注 |
| --- | --- | ---: | ---: | --- | --- |
| 主播 | 待填 | 待填 | 待填 | 待填 | 中文 |
| 状态 | 待填 | 待填 | 待填 | 待填 | 中文 |
| AI | 待填 | 待填 | 待填 | 待填 | ASCII |
| 😊 | 待填 | 待填 | 待填 | 待填 | emoji |

附录必须保存机器可读 fixture JSON、执行脚本版本/SHA 和完整 stdout。

## 3. profile 生成

1. 全量 JSONL 先通过严格 schema 和业务校验，任一非法记录使本批失败。
2. 用冻结 pipeline 对全部有效 `pre_set` 分词，记录每条 `doc_len`。
3. 计算并冻结 `avg_doc_len_baseline = sum(doc_len) / valid_document_count`。
4. 以候选 `k1`、`b` 生成文档侧 BM25 TF 长度归一权重；不得预乘 IDF。
5. 创建临时双 collection，稀疏向量名固定 `bm25_zh_jieba_v1`，开启 `modifier: idf`。
6. 批量写入、校验点数/索引/查询 fixture，成功后才切换 alias。

```json
{
  "profileId": "待填",
  "tokenizerVersion": "zh_jieba_search_v1",
  "normalizationVersion": "待填",
  "preSetSha256": "待填",
  "avgDocLenBaseline": null,
  "k1": null,
  "b": null,
  "qdrantVersion": "待填",
  "calibrationArtifactId": "待填"
}
```

## 4. 中文检索与校准基准

测试集必须覆盖：人设相关、正向夸赞、玩笑、互动提问、气氛带动、低价值、高风险、昵称错别字/同音字、短弹幕、最大长度弹幕。每条由甲方标注期望语义和可接受 TopK。

| 指标 | 目标/记录 |
| --- | --- |
| golden / pre 独立 TopK Recall@K | 待填 |
| 合并后 NDCG@K / MRR | 待填 |
| `filter_risk` 漏放率与误杀率 | 待填；安全硬规则另测 |
| raw score → `[0,1]` calibration 方法 | 待填，不允许直接跨库比较 raw score |
| direct push threshold 候选与 precision | 待填；阈值由甲方效果验收决定 |
| 查询 P50 / P95 / P99 | 待填 |
| 单点 golden 回流后可检索性与旧点不变性 | 待填 |

必须导出机器可读 `queries.jsonl`、两库原始命中、校准后命中、人工标签和评估脚本版本。用户 UI 不展示 raw score、阈值、collection 或同步状态。

## 5. 结论与签核

- profile 是否可冻结：待填。
- 未通过项与优化计划：待填。
- 甲方效果验收：待签。
- 技术负责人复核：待签。
- 冻结日期、artifact ID 与文件 SHA-256：待填。

任何关键参数变化（分词器/词典、规范化、hash namespace、`avg_doc_len_baseline`、`k1`、`b`）都必须产生新 profile 和新 collection，离线重编码后原子切换；单条 golden 回流不触发重建。
