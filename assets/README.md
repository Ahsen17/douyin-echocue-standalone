# Sidecar 二进制资产

随包交付的固定版本二进制，首次运行不得静默下载。安装包需校验版本/SHA-256/许可证。

## Qdrant v1.19.0

- `qdrant_linux`（Linux x64）SHA-256: `f3aa04dd54b303feca241878521e563a2e09ead71e14cbd6caef85e227498d50`
- `qdrant_windows.exe`（Windows x64）SHA-256: `369c562eae3d89333a13abfdb522fa209e3f587c1217a1059d817e80814ea9d4`

## DouyinLive Danmaku Server v2.2.0

- `douyinLive_linux`（Linux x64）SHA-256: `0dd4a90442566fefc4e7b57f94faca68a16e07b9a2eef356e2dea38f31c50320`
- `douyinLive_windows.exe`（Windows x64）SHA-256: `7738538a9dba51f07b1c9433560db6b6645c0fcec47423a7011c0d63999f463b`

运行：`douyinLive --port 1088`，客户端监听 `ws://127.0.0.1:1088/ws/<room_id>`。

## BM25 停用词表

- `stopwords.txt`：上游原始表（只读参考，不参与构建）。
- `stopwords-curated.txt`：生效源（人工审查版：剔除实义单字与误收词条后的子集）。修改后必须：
  1. `npm run stopwords:generate` 重新生成 `src/main/retrieval/stopwords.generated.ts`；
  2. bump `BM25_TOKENIZER_VERSION_V1`（`src/contracts/src/schemas.ts`，同步镜像 `docs/06-data-interface/schema/contracts-v1.ts`）；
  3. 按数据接口文档 §4.1 重建 pre_set / golden_set collection（重新导入 pre_set）。
