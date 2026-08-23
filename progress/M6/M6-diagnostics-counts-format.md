# M6 补记：诊断页格式、集合样本数与工作区字号

> 非路图插入任务：诊断页时间格式 `yyyy-MM-dd HH:mm:ss`、端到端耗时两位小数；新增只读 IPC 查看 pre_set/golden_set 样本数；工作区字号整体调大、页面标题统一大字号（登录页除外）。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | feat/M6-diagnostics-counts-format |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | UI §8.1（诊断页）；CONTRACT §7（只读 IPC）；UI §2/§9（导航与字号） |

## 改动

### A. 诊断页时间/耗时格式
| 文件 | 改动 |
|------|------|
| `src/renderer/main/diagnostics/diagnostics-logic.ts` | 新增 `formatDateTime`（`yyyy-MM-dd HH:mm:ss` 24h）与 `formatE2eMs`（两位小数）；`buildCopyableSummary` 改用两者 |
| `src/renderer/main/pages/DiagnosticsPage.tsx` | 指标卡时间字段用 `formatDateTime`，耗时用 `formatE2eMs` |
| `tests/unit/renderer/diagnostics-logic.test.ts` | 新增 `formatDateTime`/`formatE2eMs` 用例，`buildCopyableSummary` 断言时间格式与 `1800.00 ms` |

### B. 集合样本数（新增只读 IPC）
| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` / 镜像 | 新增 `CollectionCountsV1Schema`（`preSetPointCount`/`goldenSetPointCount` 匿名非负计数） |
| `src/shared/ipc-channels.ts` | 新增 `RetrievalGetCollectionCounts` |
| `src/main/retrieval/retrieval-control-handlers.ts` | 新增 `getCollectionCounts()`：`client.count` 两别名，异常/缺失归 0 |
| `src/main/retrieval/retrieval-control-ipc.ts` | 注册只读 handler（仅可信主窗口 sender） |
| `src/preload/main-preload.ts` | `retrieval.getCollectionCounts` |
| `src/renderer/main/pages/DiagnosticsPage.tsx` | 新增「检索库样本」区块（与链路健康指标分离），显示两集合条数 |
| 测试 | `retrieval-control-handlers.test.ts`（+2 用例）、`preload-surface.test.ts`（surface 键）、`ipc-allowlist.test.ts`（31 channel）、`T-SCOPE-001-scope-reverse.test.ts`（认证 retrieval.* 白名单） |

### C. 工作区字号（Task 6）
| 文件 | 改动 |
|------|------|
| `src/renderer/main/styles.css` | `.app` 作用域字号整体调大一档：page-heading 标题统一 28px、菜单/正文/提示小字 +1~2px；登录页（`.welcome-*`）不受影响 |

## 关键设计点

- 集合计数为纯点数量，无案例原文/阈值/同步细节，符合 T-SCOPE-001 范围反向（`retrieval.*` 仅允许已认证的初始化+只读计数通道）。
- 计数读取对 qdrant 不可用/collection 缺失失败归 0，不抛内部错误；不影响诊断页其它指标。
- 字号变更全部收在 `.app` 作用域内，welcome 登录页字号保持不变。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1071 通过、5 跳过
- `npm run build`：通过
- 新增用例：diagnostics-logic（formatDateTime/formatE2eMs/摘要格式）、retrieval-control-handlers（getCollectionCounts 正常/失败归 0）

## 未关闭风险

- `formatDateTime` 按本机时区输出；跨时区部署时显示本地时间，符合 UI 预期。
- 集合计数在 qdrant 停止时显示 0；如甲方希望区分「未启动」与「空库」，可再扩展为可选字段。
