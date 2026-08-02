import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    vue(),
  ],
  preview: {
    host: '127.0.0.1',
    port: 11000,
    strictPort: true,
  },
  server: {
    host: '127.0.0.1',
    port: 11000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:11001',
      },
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
