# M7-09 生成正式 manifest、SHA、签名和 SBOM

## 任务信息

| 字段 | 内容 |
|------|------|
| 任务 ID | M7-09 |
| 任务名称 | 生成正式 manifest、SHA、签名和 SBOM |
| 状态 | ✅ 已完成 |
| 完成时间 | 2026-08-23 |
| 分支 | feat/M7-08-09 |
| 前置 | M7-08 |
| 追溯 | T-PKG-001、A-09；安装包清单 §2/§4 |

## 产出文件

- `scripts/generate-release-manifest.ts`（新）— 从候选安装包生成只读发布归档
- `tests/unit/release-manifest.test.ts`（新）— `buildReleaseManifest` 字段断言
- `.github/workflows/package-windows.yml` — 接入 `release:manifest` 步骤（M7-08 已建 workflow，本任务补步骤，同一提交内脚本即就绪）

## 实现说明

### 数据来源
- 应用版本：`package.json.version`；Git commit：`git rev-parse HEAD`；Electron 运行时：`node_modules/electron/package.json`。
- Qdrant/douyinLive 真实版本：CI 上探测 `assets/*_windows.exe --version`（douyinLive 输出 `tag=vX`、qdrant 输出版本行），失败回退 `assets/README.md` 的固定版本标注。
- SHA-256：installer（`release/*Setup*.exe`）、两 sidecar、icon/tray PNG、SBOM 文件自身。
- 许可证：`dist/compliance/licenses.json` 包计数；SBOM ref 含 `sbom.cdx.json` 路径 + 自身 SHA。

### 输出
- `release/manifest.json`（机器可读）+ `release/hashes.json`（artifact→SHA 表）+ `release/Echocue-Windows安装包清单-v<ver>-<commit>.md`（版本化只读清单副本）。
- **设计模板不改写**：`docs/11-implementation/Echocue-Windows安装包清单与兼容矩阵-v0.1.md` 保持「待填」模板；本任务只生成新副本，符合 roadmap「不得回写设计模板伪装历史发布证据」。

### 签名
- 无代码签名证书 → `signature: unsigned (no code-signing cert; 需发布环境证书补签)`，如实记录不伪造；证书接入（CSC_LINK/CSC_KEY_PASSWORD）与正式签名列为待人工/甲方门禁项。

### 接入
- `package-windows.yml`：`package:win` → `package:verify` → `release:manifest` → 上传 `release/` + `dist/compliance/`。

## 测试命令

```bash
npm run typecheck && npm run test:contracts && npm run test && npm run build
```

全量结果：typecheck 零错误；contract 149/149；vitest 1006 passed / 5 skipped；build 通过。单测覆盖 manifest 字段（版本/commit/sidecar/hash/SBOM ref/unsigned）与 markdown 无「待填」残留。

## 已知限制 / 待人工门禁
- 正式代码签名未执行（无证书），manifest 如实标 unsigned；甲方/发布环境补签后更新发布归档。
- 本任务不验证真实跨版本升级（归 M7-10）；真实安装包 POC 的 douyinLive 证据归 M4-05。

## 追溯
- T-PKG-001、A-09；安装包清单 §2/§4；无契约/migration/schema 变更。
