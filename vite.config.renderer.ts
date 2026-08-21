import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/main/index.html'),
        overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
      },
    },
    outDir: 'dist/renderer',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
  },
})
