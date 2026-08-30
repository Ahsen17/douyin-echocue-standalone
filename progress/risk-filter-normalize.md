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
| `src/main/safety/risk-filter-config.ts` | `compileRiskFilter` 关键词归一化由 `toLowerCase()` 改为 `normalizeComment(keyword)`，并丢弃归一化后为空的关键词（防 `includes('')` 全匹配事故）；`detectConfiguredRisk` 对 haystack 内部执行 `normalizeComment`（幂等），使输出路径原始文本与关键词同规范形（评审 M1 回归修复） |
| `src/main/retrieval/pre-set-importer.ts` | `unsafeField` 直接传字段原值，归一化统一由 `detectConfiguredRisk` 收口 |

归一化收口：关键词在 `compileRiskFilter` 归一化一次；所有路径（输入/输出/pre_set 导入）的 haystack 在 `detectConfiguredRisk` 归一化一次。输入/导入路径已归一化文本经幂等归一化无副作用。

不改：编译安全策略关键词（M2-03/04 同类不对称，记为关联后续）。

## 测试

- `tests/unit/safety/risk-filter-config.test.ts`：更新 `ID Card` 用例（空白压缩后 `idcard`）；新增整条拷贝含表情占位符回归、空关键词守卫、全角 NFKC 对齐、原始文本 haystack（输出路径）回归
- `tests/unit/retrieval/pre-set-importer.test.ts`：新增全角空格分隔关键词回归（`手机　号` 归一化后命中 `手机号`）

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1166 passed / 5 skipped（跳过项为既有 e2e 安装测试）
- `npm run build` ✅
- Subagent 严格审查两轮：第一轮发现输出路径回归（M1）已修复；第二轮复核通过

## 已知行为（有意的边界语义）

- **URL / 域名关键词在输出路径与 pre_set 导入均失效（评审 F2，需团队确认接受）**：`normalizeComment` 剥离 URL，整 URL 关键词编译时被丢弃、裸域名关键词虽保留但 haystack 已剥离 URL → 所有路径（含此前可拦截的 LLM 输出）不再以 URL 关键词命中。弹幕输入路径本就剥离 URL，实时安全姿势不变；编译安全策略 KEYWORD/REGEX 仍可在输出路径命中 URL，回退影响有限。若需保留 URL 关键词拦截，作为后续任务。
- **`normalizeComment` 对常规输入幂等（评审 F3）**：对「大写 scheme URL」「嵌套方括号」等极边缘输入二次归一化结果不同（已归一化文本上再归一化为无副作用），真实弹幕极罕见、无假阳性；注释已相应表述。URL_RE 加 `i` 标志或彻底幂等化可作后续小修。
- **词间空格语义消失**：关键词空白被压缩（与弹幕归一化对齐），`no spam` 会命中弹幕 `nospam`。低风险，属设计意图。
- **编译安全策略（`SafetyRuleCompiler` / policy keywords/topic）存在同类归一化不对称**，可复用同一 `normalizeComment` 思路作为后续任务。
