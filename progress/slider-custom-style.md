# slider 定制样式（slider-custom-style）

> 将全部 slider（原生 `<input type="range">`）从浏览器默认外观改为定制样式：细轨道 + 蓝色进度填充 + 白色圆钮，视觉与应用蓝色圆角语言一致。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 插入任务（非路图原子任务） |
| 分支 | feat/slider-history-close |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-30 |

## 需求与决策

| 决策 | 结论 |
|------|------|
| 覆盖范围 | 主应用「浮窗偏好」面板 2 处（透明度/字号）+ 原型 2 处（透明度/字号），共 4 处 |
| 轨道 | 4px 细圆角轨道，蓝色填充当前进度、浅灰表示余量 |
| 滑块 | 14px 白色圆钮 + 蓝色描边；hover 光晕 + 微缩放；focus-visible 焦点环 |
| 实现方式 | 纯 CSS 伪元素定制 + 组件内联 `--range-pct` CSS 变量驱动填充百分比，无新依赖 |

## 设计要点

- **改细 + 美化**：`-webkit-appearance:none` 去掉默认外观；覆盖通用 `input,textarea,select` 规则残留的 padding/border/background。
- **进度填充**：`::-webkit-slider-runnable-track` 用 `linear-gradient(to right, var(--blue) 0 var(--range-pct,0%), #dfe5ec var(--range-pct,0%) 100%)`；`--range-pct` 由组件按 `(value-min)/(max-min)` 计算内联传入。
- **垂直居中**：thumb `margin-top:-5px`（(4px 轨道 - 14px 圆钮)/2）。
- **浏览器兜底**：Electron 为 Chromium，主应用以 WebKit 伪元素为准；原型增加 `::-moz-range-*`（含自动填充的 `::-moz-range-progress`）供开发浏览器兜底。

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/renderer/main/styles.css` | 新增「Custom range slider」规则段（WebKit + moz） |
| `src/renderer/main/components/OverlaySection.tsx` | 两个 range input 加 `--range-pct` 内联样式；import 增加 `type CSSProperties` |
| `prototype/src/styles.css` | 追加同款规则（蓝色用 `#286eea`、光晕 rgba(40,110,234,…)） |
| `prototype/src/pages/ConfigPages.tsx` | 两个 range input 加 `--range-pct` 内联样式；import 增加 `type CSSProperties` |

不改：路由、契约 schema、IPC、OverlayPreferenceV1 字段语义、onChange 逻辑。

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 201 passed
- `npm run test` ✅ 1210 passed / 5 skipped（跳过项为既有 sidecar 二进制依赖与 Windows 安装类测试）
- 原型构建见批次级验证（`cd prototype && npm run build`）

## 已知限制与后续

- 纯视觉改动，本项目无 jsdom/截图测试栈，未新增自动化测试（与 M6-fix、TD-06 等纯样式任务先例一致）。
- 手动确认项：主应用「系统设置 → 浮窗偏好」两个 slider 显示细轨道 + 蓝色填充 + 白圆钮；原型同款。
