# TD-10：BM25 停用词接入 + tokenizer_version v2 + 版本守卫

> 技术债务批次 `feat/TD-10-11-12` 第一个原子任务（gap 插入任务，非路图原子任务）。检索 BM25 管道此前无停用词过滤，高频虚词全部进入稀疏向量，是小集合上不相干内容匹配分数虚高的根因之一。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（TD-10） |
| 分支 | feat/TD-10-11-12 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-09-29 |
| 关联 | M3-02/M3-03（分词与权重）、TD-11（集合重建迁移）、M3-09（校准，阻塞中） |

## 改动

| 文件 | 说明 |
|------|------|
| assets/stopwords-curated.txt | 新增。人工审查版停用词表（2376 行），源为用户提供的 assets/stopwords.txt（2416 行，未改动） |
| scripts/generate-stopwords.ts | 新增 codegen：读 curated 表 → trim/去空/去重/丢弃纯数字标点行 → 排序 → 生成 TS 模块（含 sha256） |
| src/main/retrieval/stopwords.generated.ts | 新增生成物（2275 条，SHA-256 `ffa6d49b…f02dd9`），提交入库并随主进程打包内联 |
| src/main/retrieval/Bm25TextPipeline.ts | `tokenize()` 在 `isKeepableToken` 后追加整词匹配停用词过滤；索引侧与查询侧同走该函数 |
| src/contracts/src/schemas.ts + docs/06-data-interface/schema/contracts-v1.ts | `BM25_TOKENIZER_VERSION_V1` bump `zh_jieba_search_v1` → `zh_jieba_search_v2` |
| src/main/retrieval/bootstrap.ts | payload `tokenizer_version` 硬编码字面量改为契约常量 |
| src/main/retrieval/retriever.ts | 新增版本守卫：首次 `search()` 前校验两别名 collection metadata 的 `tokenizer_version`/`normalization_version`，不一致或缺失 → 返回空 hits 并缓存标志（`hasVersionMismatch()`） |
| src/main/retrieval/retrieval-control-handlers.ts | `getStatus()` 在 pre_set metadata 版本不符时返回 `ready:false, error:'E_TOKENIZER_MISMATCH'` |
| src/renderer/main/run/retrieval-state.ts + components/RetrievalCard.tsx | 新增 `version-mismatch` 态与提示文案「检索数据版本不匹配…请重新导入 pre_set」 |
| docs/06-data-interface/Echocue-数据模型、接口与实时事件协议-v0.1.md | §4 分词流程补停用词过滤步骤、版本约束与重建要求 |
| assets/README.md | 登记两张表维护约定与变更流程 |
| 测试/fixture 约 20 处 | `'zh_jieba_search_v1'` 机械替换为 import `BM25_TOKENIZER_VERSION_V1`（防未来 bump 遗漏）；4 个 docs fixture JSON 同步 v2 |

## 停用词审查决策

- **剔除**实义单字（38 个）：好 大 小 多 快 打 拿 看 说 叫 做 传 定 带 赶 怕 敢 怪 满 独 立 粗 纯 老 见 臭 蛮 饱 齐 光 白 种 分 中 人 活 冲；**剔除**误收多字条目：老大 长线 陈年。
- **保留**（与计划候选清单的偏差）：「会」（助动词，功能词）、「上/下」（方位词；「上分/下播/上头」等均整体成词，单字仅作方位/助词）。
- 保留代词、虚词助词、时间量词、否定词、叹词、数字、标点为停用词；codegen 丢弃纯数字/标点/符号行（与 `isKeepableToken` 既有过滤重叠）。
- 过滤为**整词匹配**：含停用词字的多字 token（好活/上分/不行）不受影响，已有测试断言。

## 升级行为

- 已有 v1 数据的安装升级后：`getStatus()` 返回 `E_TOKENIZER_MISMATCH`，检索卡片提示重新导入；期间 `search()` 返回空 hits，弹幕全部走 LLM-first（`llm-semantic-reject` 仍可驳回），不会产生跨版本错误分数。
- golden_set 为空向量点（纯停用词文本）在 TD-11 重建流程中处理。

## 基线影响（docs/06-data-interface/fixtures/pre-set-valid-v1.jsonl，6 条）

- `avg_doc_len_baseline` 由 7.5 降至 3.5（停用词 token 不再计入 docLen）。
- **验证清单**：占位校准 `{center:0, scale:2}` 下置信度分布整体上移，运行页需现场复核 direct-push 0.85 与语义丢弃 0.9 两门松紧；M3-09 校准落地时一并重推。

## 验证

- `npm run typecheck`：0 错误。
- `npm run test:contracts`：214 通过。
- `npm run test`：1258 通过（新增 `tests/unit/retrieval/stopwords.test.ts` 9 项：过滤生效、索引/查询一致、整词匹配、实义单字保留、空分析、确定性、sha256 完整性、生成物与源一致、无重复/空条目/纯符号行；retriever 版本守卫 4 项；getStatus mismatch 1 项；renderer 四态映射 1 项）。
- 无敏感内容：测试全部使用合成弹幕样本。

## 已知风险

- 停用词表误杀需试运行反馈：在 `assets/stopwords-curated.txt` 删行 → `npm run stopwords:generate` → bump 版本 → 重新导入。
- `docs/03-research/Echocue-Qdrant-jieba-BM25-POC记录模板-v0.1.md` 的版本样例同步 v2，POC 校准记录仍待甲方样本（M3-09）。
