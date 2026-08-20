# 直播间实时互动助手文档

本目录保存直播间实时互动助手 MVP 的项目级技术指导大纲。

产品围绕主播 / 直播间风格驱动的实时互动能力展开，技术架构覆盖弹幕接入、Workflow 持久化、语义服务、账号权限服务、规则体系、client 浮窗、服务端 Workflow 回放和 Prometheus / OpenTelemetry 观测。

## 目录结构

| 目录 | 定位 | 内容 |
| --- | --- | --- |
| [product](./product/) | Product Requirements | 产品范围、用户角色、业务能力、MVP 需求边界。 |
| [architecture](./architecture/) | Technical Architecture | 技术选型、服务边界、Workflow 运行策略、数据与安全规则结构。 |
| [delivery](./delivery/) | Delivery Plan | MVP 主路径、里程碑、交付物、验收标准、QA 总结和技术债务。 |

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [产品范围](./product/product-scope.md) | MVP 目标、用户角色、核心产品决策。 |
| [架构指导](./architecture/architecture-guide.md) | 服务边界、技术选型、部署形态。 |
| [运行策略](./architecture/runtime-strategy.md) | Workflow 触发、Agent 使用、安全处理、回放记录和互动识别。 |
| [MVP 里程碑计划](./delivery/mvp-roadmap.md) | MVP 主路径、阶段交付物、验收标准和依赖关系。 |
| [当前阶段功能实现规划](./delivery/current-stage-implementation-plan.md) | 当前阶段的实现顺序、模块边界、验收方式和 M2 实现规划。 |
| [QA 阶段总结与后续澄清清单](./delivery/QA阶段总结与后续澄清清单.md) | 当前 QA 阶段有效结论和后续核心澄清点。 |
| [技术债务与后续规划](./delivery/technical-debt.md) | 后续规划、占位能力、规则整改机制和技术债务。 |
