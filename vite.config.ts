import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The same .env the API reads. Used to let an https tunnel (needed for bank OAuth) reach the dev server.
  const env = loadEnv(mode, process.cwd(), '')
  const tunnelHost = (() => {
    try {
      return env.PLAID_REDIRECT_URI ? new URL(env.PLAID_REDIRECT_URI).hostname : undefined
    } catch {
      return undefined
    }
  })()

  return {
    plugins: [react()],
    server: {
      // Never slide to another port: the ngrok tunnel and redirect address point at 5173.
      strictPort: true,
      // Vite refuses requests for unknown host names. Allow only the tunnel named in .env.
      ...(tunnelHost ? { allowedHosts: [tunnelHost] } : {}),
      // Forward /api calls to the Node backend (server/) so the browser sees one origin.
      proxy: {
        // API_PROXY_TARGET is only for running a second API next to the main one (for example in testing).
        '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
      },
    },
  }
})
