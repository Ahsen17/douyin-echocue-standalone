import { defineConfig } from 'vite'
import { resolve } from 'path'

// Single-entry preload build, see vite.config.preload-main.ts. emptyOutDir is
// off here so a concurrent dev watcher never clears the other preload's output.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/preload/overlay-preload.ts'),
      formats: ['cjs'],
      fileName: () => 'overlay-preload.cjs',
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
