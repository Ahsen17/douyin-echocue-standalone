import { defineConfig } from 'vite'
import { resolve } from 'path'

// Node built-ins are never bundled; keep `node:`-prefixed and bare forms both
// external (imports use either style across src/main).
const NODE_BUILTINS = new Set([
  'child_process', 'cluster', 'crypto', 'events', 'fs', 'http', 'https',
  'net', 'os', 'path', 'process', 'sqlite', 'stream', 'url', 'util',
  'worker_threads', 'zlib',
])

function isExternal(id: string): boolean {
  if (id.startsWith('node:')) return NODE_BUILTINS.has(id.slice('node:'.length))
  return (
    NODE_BUILTINS.has(id) ||
    id === 'electron' ||
    id === 'jieba-wasm' ||
    id === '@qdrant/js-client-rest' ||
    // ws has a "browser" field; bundling it for the Node main process resolves
    // to ws/browser.js whose WebSocket is not a constructor in Electron main.
    // Keep it external so runtime require('ws') uses the Node build.
    id === 'ws'
  )
}

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    outDir: 'dist/main',
    emptyOutDir: true,
    rollupOptions: {
      external: isExternal,
    },
    minify: false,
    sourcemap: true,
  },
})
