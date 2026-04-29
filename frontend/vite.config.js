import { defineConfig } from 'vite'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  plugins: [
    Icons({
      compiler: 'raw',
      autoInstall: true
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})