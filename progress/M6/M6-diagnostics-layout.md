# M6 补记：诊断页「链路健康」与「检索库样本」布局统一并补齐间距

> 非路图插入任务：审查反馈——「检索库样本」与上方内容无 margin 贴得太紧；「链路健康」与「检索库样本」同属一个层级但两块组织方式不一致。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入修复（非路图原子任务） |
| 分支 | fix/M6-diagnostics-layout |
| 状态 | ✅ 已完成（待审查） |
| 完成时间 | 2026-08-24 |
| 追溯 | UI §8.1（诊断）；M6-diagnostics-counts-format（检索库样本区块） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/renderer/main/pages/DiagnosticsPage.tsx` | 检索库样本由「标题+描述+内嵌 compact 平铺」改为与链路健康一致的「标题 card + 下方 metrics 卡片网格」结构；两项计数使用 `.metrics.two` |
| `src/renderer/main/styles.css` | `.metrics` 补 `margin-bottom:20px`（与 `.card` 间距一致，解决紧凑贴靠）；新增 `.metrics.two{grid-template-columns:repeat(2,1fr)}` |

## 关键设计点

- **统一组织**：两块内容（链路健康 / 检索库样本）均采用「标题 card（● 标题 + 描述）+ 其下 metrics 卡片网格」，同属一个层级、结构一致。
- **间距修复**：`.metrics` 网格增加底部 20px margin，`检索库样本` 区块不再紧贴上方内容；`.metrics.compact` 的 `margin:16px 0` 仍覆盖生效，RunPage 的活动指标不受影响。
- 无契约、无 IPC、无逻辑改动，纯 TSX/CSS。

## 验证

- `npm run typecheck`：通过
- `npm run test:contracts`：169 通过
- `npm run test`：1081 通过、5 跳过
- `npm run build`：通过

## 未关闭风险

- 无。
