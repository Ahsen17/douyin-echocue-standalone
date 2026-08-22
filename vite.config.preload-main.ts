import { defineConfig } from 'vite'
import { resolve } from 'path'

// Single-entry preload build: sandboxed preloads cannot `require` shared chunks,
// so the whole bundle (including ipc-channels) must inline into one file.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/preload/main-preload.ts'),
      formats: ['cjs'],
      fileName: () => 'main-preload.cjs',
    },
    outDir: 'dist/preload',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron'],
    },
    minify: false,
    sourcemap: true,
  },
})
