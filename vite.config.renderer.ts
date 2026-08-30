import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // root 下移到 src/renderer，使两个 HTML 以相同深度输出到 dist/renderer 根层，
  // 配合 base './' 让 file:// 协议下资源引用可解析
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/main/index.html'),
        overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        history: resolve(__dirname, 'src/renderer/history/index.html'),
      },
    },
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
  },
})
