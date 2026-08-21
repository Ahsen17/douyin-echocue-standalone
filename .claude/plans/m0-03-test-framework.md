# M0-03 测试骨架规划

## 任务信息

- **任务 ID**: M0-03
- **任务名称**: 建立 Unit/Contract/Integration/E2E 测试骨架
- **前置任务**: M0-01, M0-02
- **追溯**: 全部 T-* testcase
- **规划日期**: 2026-08-21

## 目标

建立四层自动化测试框架，为后续所有原子任务提供可独立验证的测试入口，确保分层测试命令、fixture loader、Windows CI 入口和失败退出码可靠。

## 当前状态评估

### 已有基础

1. **contracts 子包测试**（M0-02 产出）
   - 位置: `src/contracts/test/schemas.test.ts`
   - 模式: 手写 runner + Node 内置 assert
   - 覆盖: 40 个契约测试（SettingsV1、ServiceViewState、ProviderConfig 等）
   - 运行: `npm run test:contracts` (使用 tsx)

2. **可用 fixture 资产**
   - `docs/06-data-interface/fixtures/safety-policy-fixtures-v1.json` (2KB, 编译+运行时 5 条)
   - `docs/06-data-interface/fixtures/provider-contract-fixtures-v1.json` (3KB, 5 条 adapter 契约)
   - `docs/06-data-interface/fixtures/migration-contract-test.mjs` (3KB, SQLite 约束验证)
   - `docs/05-data-interface/fixtures/pre-set-*.jsonl` (BM25 检索用，未来 M3 使用)

3. **项目基础设施**
   - workspace: `src/contracts` 已作为独立子包
   - 构建工具: Vite 6.0.3
   - 运行时: tsx 4.23.12 (当前测试执行器)
   - CI 平台: 需新建 (Windows x64 要求)

### 缺失内容

- ❌ 无专业测试框架 (vitest/jest)
- ❌ 无测试目录分层结构
- ❌ 无 fixture loader 工具函数
- ❌ 无 Unit/Integration/E2E 测试入口
- ❌ 无 Windows CI workflow
- ❌ 无覆盖率工具
- ❌ 无测试分层脚本 (test:unit/contract/integration/e2e)

## 最小阅读包

- ✅ `DELIVERY §4.1` — 四层测试分层定义和最低要求
- ✅ `DELIVERY §4.4` — testcase ID (T-CON-001 ~ T-SCOPE-001)
- ✅ `DELIVERY §8` — Definition of Done (Windows x64 打包冒烟)
- ✅ 现有 fixture 文件 (3 个 JSON/mjs)
- ✅ `src/contracts/test/schemas.test.ts` — 现有测试模式

## 包含范围

1. **测试框架选型与配置**
   - 引入 Vitest (与 Vite 生态一致，原生 ESM，支持 Node/浏览器，watch 模式)
   - 配置文件: `vitest.config.ts` (workspace root)
   - 覆盖率工具: `@vitest/coverage-v8`

2. **目录骨架 (tests/)**
   ```
   tests/
   ├── unit/               # T-SAFE-001, T-PER-001, T-RET-001 占位
   ├── contract/           # T-CON-001, T-PROV-001, T-DIAG-001 占位
   ├── integration/        # T-AUD-001, T-STO-001, T-CON-002 占位
   ├── e2e/                # T-OVR-001, T-PKG-001 占位
   ├── fixtures/           # fixture loader + 引用 docs/06-data-interface/fixtures/
   └── setup/              # 测试全局配置和帮助函数
   ```

3. **Fixture Loader 工具**
   - `tests/fixtures/loader.ts`
   - 功能: 加载 JSON/JSONL fixture，返回类型安全对象
   - 支持: safety-policy, provider-contract, pre-set (future)

4. **测试脚本 (package.json)**
   ```json
   {
     "test": "vitest run",
     "test:unit": "vitest run tests/unit",
     "test:contract": "vitest run tests/contract",
     "test:integration": "vitest run tests/integration",
     "test:e2e": "vitest run tests/e2e",
     "test:watch": "vitest",
     "test:coverage": "vitest run --coverage",
     "test:contracts": "tsx src/contracts/test/schemas.test.ts"  // 保留现有
   }
   ```

5. **Testcase ID 占位文件**
   - 每个 T-* ID 创建一个占位测试文件 (skip 或 TODO 标记)
   - 示例: `tests/contract/T-CON-001-ws-event-fixtures.test.ts`
   - 目的: 建立追溯矩阵，后续任务填充实现

6. **Windows CI 入口**
   - `.github/workflows/test-windows.yml`
   - 运行环境: `windows-latest` (x64)
   - 运行范围: Integration + E2E 层 (Unit/Contract 可在任意 OS)
   - 失败退出码: 非零码中断 CI

7. **contracts 子包迁移决策**
   - **保留** 现有 `test:contracts` 和 schemas.test.ts (不迁移)
   - 理由: 已有 40 个测试稳定运行，迁移成本 > 收益
   - 未来: contracts 子包可选地自行引入 vitest (独立决策)

## 不包含范围

- ❌ 实现具体业务测试 (T-CON-001 ~ T-SCOPE-001 的实际测试逻辑)
- ❌ SQLite / Qdrant / douyinLive 集成测试 (属于 M1/M3/M4 任务)
- ❌ Electron 测试工具 (Playwright / Spectron) (属于 M6 E2E 任务)
- ❌ 真实 Provider 凭证 / 真实直播间 POC (属于 M2-06/M3-09/M4-05)
- ❌ 迁移现有 contracts/test/schemas.test.ts 到 Vitest
- ❌ 性能基准测试工具 (T-PERF-001) (属于 M5-08)
- ❌ 人工验收流程 (T-QUAL-001) (属于 M7-06)

## 必须保持的不变量

1. **分层隔离**: Unit 不依赖 I/O，Contract 不依赖真实凭证，Integration 需真实 SQLite/Qdrant，E2E 需完整 Electron 进程
2. **Windows x64 约束**: Integration/E2E 必须能在 Windows CI 环境运行
3. **失败可靠性**: 测试失败必须退出非零码，不能吞掉错误
4. **Fixture 权威性**: docs/06-data-interface/fixtures/ 是唯一契约数据源，不在测试代码中硬编码
5. **contracts 独立性**: @echocue/contracts 子包保持零测试框架依赖 (仅 zod)
6. **契约优先**: Schema/fixture 冲突时停止实现，修正文档

## 建议代码边界

```
根目录:
├── vitest.config.ts                     (Vitest 主配置)
├── package.json                         (新增测试脚本 + devDeps)
├── .github/workflows/test-windows.yml   (Windows CI)

tests/:
├── fixtures/
│   ├── loader.ts                        (fixture 加载器)
│   └── index.ts                         (导出所有 fixture 路径常量)
├── setup/
│   ├── vitest.setup.ts                  (全局 beforeAll/afterAll)
│   └── helpers.ts                       (通用断言/mock 辅助)
├── unit/
│   └── .gitkeep                         (占位，后续任务填充)
├── contract/
│   ├── T-CON-001-ws-event-fixtures.test.ts      (占位)
│   ├── T-PROV-001-provider-contract.test.ts     (占位)
│   └── T-DIAG-001-diagnostic-privacy.test.ts    (占位)
├── integration/
│   ├── T-AUD-001-audit-storage.test.ts          (占位)
│   ├── T-STO-001-sqlite-wal.test.ts             (占位)
│   └── T-CON-002-ws-lifecycle.test.ts           (占位)
└── e2e/
    ├── T-OVR-001-overlay-window.test.ts         (占位)
    └── T-PKG-001-windows-install.test.ts        (占位)

src/contracts/test/:
└── schemas.test.ts                      (保持不变，继续用 tsx 运行)
```

## 实现步骤

### 步骤 1: 安装测试依赖

```bash
npm install -D vitest @vitest/ui @vitest/coverage-v8
```

### 步骤 2: 创建 vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts',
        'prototype/',
        'dist/',
      ],
    },
    // Unit/Contract 可并行，Integration/E2E 串行
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
  resolve: {
    alias: {
      '@echocue/contracts': path.resolve(__dirname, './src/contracts/src'),
    },
  },
});
```

### 步骤 3: 创建目录结构

```bash
mkdir -p tests/{unit,contract,integration,e2e,fixtures,setup}
touch tests/unit/.gitkeep
```

### 步骤 4: 实现 Fixture Loader

`tests/fixtures/loader.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, '../../docs/06-data-interface/fixtures');

export function loadJsonFixture<T = unknown>(filename: string): T {
  const filePath = path.join(FIXTURES_ROOT, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function loadJsonlFixture<T = unknown>(filename: string): T[] {
  const filePath = path.join(FIXTURES_ROOT, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

// Fixture 路径常量
export const FIXTURES = {
  SAFETY_POLICY: 'safety-policy-fixtures-v1.json',
  PROVIDER_CONTRACT: 'provider-contract-fixtures-v1.json',
  MIGRATION_TEST: 'migration-contract-test.mjs',
} as const;
```

`tests/fixtures/index.ts`:

```typescript
export { loadJsonFixture, loadJsonlFixture, FIXTURES } from './loader.js';
```

### 步骤 5: 创建测试设置文件

`tests/setup/vitest.setup.ts`:

```typescript
import { beforeAll, afterAll } from 'vitest';

// 全局测试生命周期 hooks (如需)
beforeAll(async () => {
  // 未来: 启动共享测试资源 (如 Qdrant sidecar for integration)
});

afterAll(async () => {
  // 未来: 清理测试资源
});
```

`tests/setup/helpers.ts`:

```typescript
import { expect } from 'vitest';

/** 通用断言: 验证 Zod schema 通过 */
export function expectValid<T>(
  schema: { parse: (input: unknown) => T },
  value: unknown,
  label?: string
): void {
  expect(() => schema.parse(value), label).not.toThrow();
}

/** 通用断言: 验证 Zod schema 拒绝 */
export function expectInvalid<T>(
  schema: { parse: (input: unknown) => T },
  value: unknown,
  label?: string
): void {
  expect(() => schema.parse(value), label).toThrow();
}
```

### 步骤 6: 创建 Testcase 占位文件 (Contract 层示例)

`tests/contract/T-CON-001-ws-event-fixtures.test.ts`:

```typescript
import { describe, it } from 'vitest';

describe('T-CON-001: WebSocket Event Fixtures', () => {
  it.todo('should validate ONLINE event fixture');
  it.todo('should validate OFFLINE event fixture');
  it.todo('should validate ENDED event fixture');
  it.todo('should validate COMMENT event fixture');
  it.todo('should reject gift/like events');
});
```

`tests/contract/T-PROV-001-provider-contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';

describe('T-PROV-001: Provider Contract Fixtures', () => {
  it('should load provider contract fixture', () => {
    const fixture = loadJsonFixture(FIXTURES.PROVIDER_CONTRACT);
    expect(fixture).toBeDefined();
    expect(Array.isArray(fixture)).toBe(true);
  });

  it.todo('should validate DeepSeek success case');
  it.todo('should validate OpenAI-compatible success case');
  it.todo('should reject tool_calls with E_PROVIDER_PROTOCOL');
  it.todo('should handle timeout with E_PROVIDER_TIMEOUT');
  it.todo('should reject invalid output with E_PROVIDER_OUTPUT_INVALID');
});
```

`tests/contract/T-DIAG-001-diagnostic-privacy.test.ts`:

```typescript
import { describe, it } from 'vitest';

describe('T-DIAG-001: Diagnostic Data Privacy', () => {
  it.todo('should not include message content in metrics');
  it.todo('should not include persona text in logs');
  it.todo('should not include API keys in diagnostics');
  it.todo('should not include trace_id in Prometheus labels');
  it.todo('should allow semantic categories only');
});
```

类似地为所有 T-* ID 创建占位文件 (Integration/E2E 层同理)。

### 步骤 7: 更新 package.json 脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:contract": "vitest run tests/contract",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "vitest run tests/e2e",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:contracts": "tsx src/contracts/test/schemas.test.ts",
    "test:all": "npm run test:contracts && npm run test"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "@vitest/ui": "^2.1.8",
    "@vitest/coverage-v8": "^2.1.8"
  }
}
```

### 步骤 8: 创建 Windows CI Workflow

`.github/workflows/test-windows.yml`:

```yaml
name: Test on Windows

on:
  push:
    branches: [master, develop]
  pull_request:
    branches: [master]

jobs:
  test-windows:
    runs-on: windows-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run contract tests (cross-platform)
        run: npm run test:contracts

      - name: Run unit tests (cross-platform)
        run: npm run test:unit

      - name: Run contract layer tests (cross-platform)
        run: npm run test:contract

      - name: Run integration tests (Windows x64 required)
        run: npm run test:integration

      - name: Run E2E tests (Windows x64 required)
        run: npm run test:e2e

      - name: Type check
        run: npm run typecheck
```

### 步骤 9: 验证骨架

```bash
# 1. 安装依赖
npm install

# 2. 运行 fixture loader 测试
npm run test:contract

# 3. 验证所有测试脚本可执行 (即使是 TODO)
npm run test:unit
npm run test:integration
npm run test:e2e

# 4. 验证现有 contracts 测试不受影响
npm run test:contracts

# 5. 运行全量测试
npm run test:all

# 6. 验证失败退出码
npm run test:contract && echo "PASS" || echo "FAIL (expected if any test fails)"
```

## 测试要求

### 正常路径
- ✅ `npm run test` 执行 Vitest，扫描 tests/ 目录
- ✅ `npm run test:unit/contract/integration/e2e` 分层运行
- ✅ `loadJsonFixture()` 成功加载 fixture
- ✅ Testcase 占位文件通过编译 (it.todo 不算失败)

### 边界路径
- ✅ 不存在的 fixture 文件抛出清晰错误
- ✅ 空测试目录不导致测试失败 (.gitkeep 被忽略)
- ✅ TODO 测试不阻塞 CI (标记为 pending)

### 失败路径
- ✅ 测试失败返回非零退出码 (验证: `npm run test || echo $?`)
- ✅ Fixture JSON 格式错误时测试失败
- ✅ Import 错误被 Vitest 捕获并报告

### Windows x64 要求
- ✅ Integration/E2E 测试能在 `windows-latest` 环境运行
- ✅ 路径分隔符 (\ vs /) 不影响 fixture 加载
- ✅ CI workflow 在 Windows 上成功执行

## 完成标准

- [x] Vitest 配置文件存在且有效
- [x] 四层测试目录存在 (unit/contract/integration/e2e)
- [x] Fixture loader 实现且能加载 3 个现有 fixture
- [x] 所有 T-* testcase ID 有占位文件 (至少 contract 层 3 个 + integration 层 3 个 + e2e 层 2 个)
- [x] package.json 包含 6 个测试脚本 (test, test:unit/contract/integration/e2e, test:coverage)
- [x] 现有 `test:contracts` 保持可用
- [x] Windows CI workflow 存在且包含 Integration/E2E 步骤
- [x] 运行 `npm run test:all` 无编译错误 (TODO 测试标记为 pending)
- [x] 测试失败返回非零退出码
- [x] `npm run typecheck` 通过

## 已知限制

1. **Testcase 实现留空**: 所有 T-* 测试文件仅占位，实际测试逻辑由后续任务 (M1-M7) 实现
2. **Electron E2E 工具未引入**: M6 任务引入 Playwright/Spectron 时需扩展 E2E 配置
3. **SQLite/Qdrant 未启动**: Integration 测试在 M1/M3 任务完成前无法运行真实集成
4. **Coverage 阈值未设置**: 当前不强制覆盖率门禁，待业务代码增长后设定
5. **contracts 子包未迁移**: schemas.test.ts 保持独立运行，未纳入 Vitest (future work)

## 后续依赖任务

- **M1-04**: migration-contract-test.mjs 需集成到 Integration 层
- **M2-03**: safety-policy-fixtures-v1.json 填充到 T-SAFE-001
- **M3-02**: BM25 fixture 填充到 T-RET-001
- **M4-02**: WS event fixtures 填充到 T-CON-001
- **M5-03**: provider-contract-fixtures-v1.json 填充到 T-PROV-001
- **M6-07**: Electron overlay 测试填充到 T-OVR-001
- **M7-04**: 全量 Contract/Integration tests 补全

## 追溯

- **文档**: DELIVERY §4.1 (测试分层), §4.4 (testcase ID), §8 (DoD)
- **Testcase**: T-PKG-001 (Windows CI), 全部 T-* (占位)
- **Acceptance**: 间接支持 A-01 ~ A-13 的自动化验证
