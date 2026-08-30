# TD-07：人设已发布内容无查看入口（查看/编辑双模式）

> 技术债务批次 `feat/TD-06-07-08` 第二个原子任务。人设页默认进入「查看」视图展示已发布版本全文与历史版本，编辑/发布作为显式动作进入表单。

## 任务信息

| 字段 | 内容 |
|------|------|
| 类型 | 技术债务（`progress/TECH-DEBT.md` TD-07） |
| 分支 | feat/TD-06-07-08 |
| 状态 | ⏳ 待审查（批次未合并） |
| 完成时间 | 2026-08-23 |
| 关联 | M2-01/M2-02（人设 CRUD 与版本）；M6-04（人设页） |

## 改动

| 文件 | 改动 |
|------|------|
| `src/contracts/src/schemas.ts` | 新增 `PersonaGetVersionContentRequestV1Schema`（personaId+personaVersion）、`PersonaVersionContentV1Schema` + 类型导出 |
| `docs/06-data-interface/schema/contracts-v1.ts` | 镜像同步（byte-identical） |
| `src/shared/ipc-channels.ts` | 新增 `PersonaGetVersionContent: 'persona.getVersionContent'`（通道 29→30） |
| `src/main/persona/persona-control-handlers.ts` | 新增 `getVersionContent` handler：`getVersionMeta` 归属校验（`meta.personaId === req.personaId`，跨成员报「版本不存在」不泄露）→ `readVersionContent` |
| `src/main/persona/persona-control-ipc.ts` | 注册新通道 |
| `src/preload/main-preload.ts` | `persona.getVersionContent(personaId, personaVersion)` |
| `src/renderer/main/pages/PersonaPage.tsx` | 重构为查看/编辑双模式：默认查看已发布全文（pre-wrap）、版本历史点击查看、别名只读、「编辑 / 发布新版本」显式进表单；预览换行与表单初始化修复 |
| 数据模型文档 | persona 通道表补 `getVersionContent` |
| `src/contracts/test/schemas.test.ts` | +4 用例（两 schema 合法/拒绝） |
| `tests/unit/ipc/ipc-allowlist.test.ts` | 通道数 29→30 + persona wire 断言 |
| `tests/unit/ipc/preload-surface.test.ts` | persona surface 加 `getVersionContent` |
| `tests/unit/persona/persona-handlers.test.ts` | +2 用例（按版本取全文、跨成员拒绝） |

## 验证

- `npm run typecheck` ✅ 零错误
- `npm run test:contracts` ✅ 169 passed / 0 failed
- `npm run test` ✅ 1063 passed / 5 skipped（既有 skip）

## 说明

- **数据源**：查看视图用 `persona.getVersionContent` 按 `activeVersion`/所选版本拉解密全文；`persona.get` 的 `editableContent` 偏向最新草稿，无法单独看已发布版本。
- **权限边界**：handler 先校验版本归属成员，跨成员按「版本不存在」拒绝，不泄露内容与归属；仅主窗口 `isTrustedSender` 可调用。
- **查看/编辑分离**：默认查看，编辑为显式动作；切换成员/保存/发布后回到查看视图并刷新当前生效内容。
