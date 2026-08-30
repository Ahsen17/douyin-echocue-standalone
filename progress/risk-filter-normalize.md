# 风险过滤关键词与弹幕归一化不对称修复

> 修复用户实测缺陷：配置风险类型【福袋】+ 关键词后，整条弹幕拷贝作为关键词不命中；仅部分子串命中。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入缺陷修复（非路图原子任务，关联 WP-10） |
| 分支 | fix/risk-filter-normalize |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-30 |

## 根因

匹配使用 `haystack.includes(term)`，但两侧归一化不对称：

- 弹幕侧经 `normalizeComment`（去 URL → NFKC → 小写 → 剔除 `[表情]` 占位符 → 压缩空白 → trim）；
- 关键词侧仅 `toLowerCase()`。

弹幕含表情占位符/内部空格/全角字符时，整条拷贝关键词含这些成分而 haystack 已剔除 → 永不命中；避开这些成分的子串反而命中。

## 改动

| 文件 | 改动 |
|------|------|
| `src/main/safety/risk-filter-config.ts` | `compileRiskFilter` 关键词归一化由 `toLowerCase()` 改为 `normalizeComment(keyword)`，并丢弃归一化后为空的关键词（防 `includes('')` 全匹配事故） |
| `src/main/retrieval/pre-set-importer.ts` | pre_set 导入 haystack 由 `NFKC+toLowerCase` 改为 `normalizeComment`，与关键词同规范形 |

不改：输出路径 `SuggestionOutputValidator`（中文 LLM 回复无 `[表情]`/内部空格，匹配等价；改它会影响编译规则语义）；编译安全策略关键词（M2-03/04 同类不对称，记为关联后续）。

## 测试

- `tests/unit/safety/risk-filter-config.test.ts`：更新 `ID Card` 用例（空白压缩后 `idcard`）；新增整条拷贝含表情占位符回归、空关键词守卫、全角 NFKC 对齐
- `tests/unit/retrieval/pre-set-importer.test.ts`：新增全角空格分隔关键词回归（`手机　号` 归一化后命中 `手机号`）

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1165 passed / 5 skipped（跳过项为既有，非本任务引入）
- `npm run build` ✅

## 已知限制（非本任务）

- 编译安全策略（`SafetyRuleCompiler` / policy keywords/topic）存在同类归一化不对称，可复用同一 `normalizeComment` 思路作为后续任务。
- 输出路径对含空白/表情的英文关键词仍可能漏检（中文直播场景可忽略）。
