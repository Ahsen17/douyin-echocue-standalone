import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
  resolve: {
    alias: {
      '@echocue/contracts': path.resolve(__dirname, './src/contracts/src'),
      // node:sqlite only appears with its node: prefix in builtinModules (Node 22+),
      // so vite's filter misses it and tries to bundle it. Redirect to a cjs wrapper
      // that uses createRequire so vite never tries to resolve it as an ES module.
      'node:sqlite': path.resolve(__dirname, './tests/setup/node-sqlite-compat.cjs'),
    },
  },
});
