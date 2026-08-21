# M0-04 实施计划：锁定依赖并建立许可证/SBOM 入口

## 任务元信息
- **任务 ID**: M0-04
- **前置任务**: M0-01
- **追溯**: W1、T-PKG-001、A-09
- **最小阅读包**: `RUNBOOK §2.1`；`安装包清单 §2`

## 当前状态
- `package.json` 依赖使用 `^` 浮动版本；`package-lock.json` 已存在
- 无许可证扫描脚本；无 SBOM 生成脚本
- CI 只跑测试，无合规检查步骤

## 包含范围

### 1. 钉死依赖版本
将 `package.json` 中所有 `^` 改为精确版本（与 `package-lock.json` 当前实际安装版本对齐），保证 `npm ci` 严格复现

### 2. 许可证扫描
添加 `license-checker` devDep，新增脚本：
- `license:scan` → 输出 `dist/compliance/licenses.json`
- `license:check` → 验证无GPL/AGPL/LGPL 等copyleft 许可证，非零退出码表示违规

### 3. SBOM 生成
添加 `@cyclonedx/cyclonedx-npm` devDep，新增脚本：
- `sbom` → 输出 `dist/compliance/sbom.cdx.json`（CycloneDX 格式）

### 4. 合规门禁脚本
`compliance` = `license:check && sbom`，CI 可以一步调用

### 5. T-PKG-001 测试
在 `tests/unit/` 添加 `pkg-compliance.test.ts`：
- lockfile 存在且为合法 JSON
- package.json 无`^` 版本前缀（精确钉版检查）
- `dist/compliance/licenses.json` 结构正确（fixture 验证）

### 6. 更新 CI 工作流
在 `test-windows.yml` 末尾追加：许可证检查步骤、SBOM 生成步骤，并上传 `dist/compliance/` 为 artifact

### 7. 进度文档
创建 `progress/M0-04.md`，更新 `progress/README.md`

## 不包含范围
- 安装包二进制 SHA-256（发布时由 CI 填写，当前仍为模板）
- douyinLive/Qdrant 二进制的随包处理（属于 M3-01/M4-01）
- electron-builder 打包配置（M0-04 只建立合规工具链入口）

## 完成标准
- `npm run compliance` 成功执行，生成许可证清单和 SBOM
- 违规许可证出现时退出码非零
- T-PKG-001 测试全部通过
- CI workflow 包含合规步骤

## 实施步骤

1. 读取 `package-lock.json`，提取精确版本号
2. 更新 `package.json`，移除所有 `^` 前缀
3. 添加 devDependencies: `license-checker`, `@cyclonedx/cyclonedx-npm`
4. 在 `package.json` 添加 scripts:
   - `license:scan`
   - `license:check`
   - `sbom`
   - `compliance`
5. 创建 `tests/unit/pkg-compliance.test.ts`
6. 更新 `.github/workflows/test-windows.yml`
7. 执行 `npm install` 更新 lockfile
8. 执行 `npm run compliance` 验证
9. 执行 `npm run test:unit` 验证 T-PKG-001
10. 创建 `progress/M0-04.md`
11. 更新 `progress/README.md`
