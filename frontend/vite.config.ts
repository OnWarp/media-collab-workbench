import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本地开发时把 /api 与 /uploads 代理到 server.js（默认 3000）
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist', // frontend/dist —— 与 wrangler.jsonc 的 assets.directory 保持一致
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          vendor: ['react', 'react-dom'],
          kumo: ['@cloudflare/kumo', '@phosphor-icons/react']
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000'
    }
  }
});
