import { defineConfig } from 'vite'
import { resolve } from 'path'

// Single-entry preload build, see vite.config.preload-main.ts. emptyOutDir is
// off here so concurrent dev watchers never clear each other's output.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/preload/history-preload.ts'),
      formats: ['cjs'],
      fileName: () => 'history-preload.cjs',
    },
    outDir: 'dist/preload',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
    },
    minify: false,
    sourcemap: true,
  },
})
