import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        'main-preload': resolve(__dirname, 'src/preload/main-preload.ts'),
        'overlay-preload': resolve(__dirname, 'src/preload/overlay-preload.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.js`,
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
