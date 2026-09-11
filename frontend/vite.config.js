// Vite 仅作为开发服务器使用（代理后端 API / WebSocket）。
// 前端本身为免构建 ESM（Vue vendored），也可由后端直接静态托管。
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
});
