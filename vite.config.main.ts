import { defineConfig } from 'vite'
import { resolve } from 'path'

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
      external: ['electron', 'path', 'fs', 'os', 'url', 'crypto', 'worker_threads', 'jieba-wasm'],
    },
    minify: false,
    sourcemap: true,
  },
})
