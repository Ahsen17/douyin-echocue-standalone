# WP 批次剩余工作包（8/11/10/5/6/9/7）

> 综合实施计划按用户指示以同一批次处理：WP-8、WP-11、WP-10、WP-5、WP-6、WP-9、WP-7 在同一分支 feat/batch-rest 实现，统一 Subagent 评审后统一 PR。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 综合计划批次（WP-8/11/10/5/6/9/7） |
| 分支 | feat/batch-rest |
| 状态 | ⏳ 待审查 |
| 完成时间 | 2026-08-24 |

## 各 WP 改动摘要

| WP | 改动 |
|------|------|
| WP-8 | 修复 pre_set 导入清空 golden_set：`bootstrapPreSet` 仅首 boot 创建 golden collection+alias，后续导入只重建 pre_set；回滚只删本次新建集合。测试：单测（首 boot/再导入/失败回滚）、集成（golden 点存活） |
| WP-11 | AI 服务表单 displayName/baseUrl 选填（handler 落默认名/DeepSeek 内置 Base URL，OPENAI_COMPATIBLE 缺 baseUrl 拒绝）；`DEEPSEEK_DEFAULT_BASE_URL` 共享常量；表单红星/选填标注 |
| WP-10 | 风险过滤配置化：`risk-filter-config`（compile/detect）、InputSafetyFilter 以配置替代内置 builtin（未配置→不过滤）、pre_set 导入/输出校验接入、orchestrator 冻结、直播设置「风险过滤」tab；契约 fixtures 同步 |
| WP-5 | 安装/数据位置：electron-builder assisted（oneClick:false + 可改目录）、installer.nsh 数据目录页→data-location.json、boot 读指针重定向 userData、settings.moveDataRoot IPC（校验→停服→复制→写指针→relaunch）、系统设置迁移 UI |
| WP-6 | 卸载可选清理：uninstaller.nsh customUnInstall（询问默认 No / /cleanData、升级跳过）、win-install-verify /cleanData 分支、package-windows.yml env 门控 |
| WP-9 | 本地构建：build-local.sh（WSL2+Docker wine 镜像 CI 等价）、build-local.ps1（Windows 主机）、package:win:local/verify:local 别名 |
| WP-7 | 文档同步：契约镜像（ProviderConfigInput 可选）、UI §2 五页导航、PRD 排队/阈值覆盖说明、架构排队/保留期、部署手册数据根+本地构建、TECH-DEBT TD-03 完成登记 |

## 验证

- `npm run typecheck` ✅
- `npm run test:contracts` ✅ 183 passed
- `npm run test` ✅ 1155 passed / 5 skipped（既有 skip）
- `npm run build` ✅
- 受影响的契约 fixtures 已同步（T-SAFE/T-PROV/T-RET 配置化风险过滤）；IPC allowlist/preload-surface/打包配置测试已更新

## 说明

- **有意变更**（PR 描述需标注）：排队覆盖「绝不排队补发」；阈值开放配置；风险过滤未配置时不过滤（替代内置保护词）。
- **Windows 侧验证**：NSIS 页面/卸载宏/verify 脚本依赖 Windows CI（package-windows.yml）；本机 WSL2 无法本地跑 makensis/PowerShell。
- 每 WP 的详细进度见 `progress/` 下的历史记录与 `TECH-DEBT.md` 综合登记。
