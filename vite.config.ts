import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api calls to the Node backend (server/) so the browser sees one origin.
    proxy: {
      // API_PROXY_TARGET is only for running a second API next to the main one (for example in testing).
      '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
    },
  },
})
