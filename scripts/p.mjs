// npm run p: everything needed to use Jackal through the public https address (for bank OAuth, like Citi).
//   1. starts the local MongoDB service if it's installed and stopped
//   2. starts the web app, the API, and the ngrok tunnel together
// The address below is set only for this run, so plain `npm run n` still works on localhost.
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const DOMAIN = 'sattire.ngrok.dev'
const ORIGIN = `https://${DOMAIN}`

// An old copy of the app still running would keep serving with the wrong settings (and ngrok would
// point at it), so stop here and say so instead of quietly starting a second one.
const inUse = (port) =>
  Promise.all(
    ['127.0.0.1', '::1'].map(
      (host) =>
        new Promise((resolve) => {
          const socket = net.connect({ port, host })
          socket.once('connect', () => (socket.destroy(), resolve(true)))
          socket.once('error', () => resolve(false))
        }),
    ),
  ).then((results) => results.some(Boolean))

const busy = []
for (const [port, what] of [[5173, 'the web app'], [4000, 'the API']]) {
  if (await inUse(port)) busy.push(`port ${port} (${what})`)
}
if (busy.length) {
  console.error(`[p] ${busy.join(' and ')} is already in use, probably by an older \`npm run n\` or \`npm run p\` that didn't close.`)
  console.error('[p] Close that terminal (or end its node processes), then run npm run p again.')
  process.exit(1)
}

// 1. MongoDB. A missing service is fine (Atlas, Docker, or started by hand), so only warn.
const startMongo = `
$svc = Get-Service -Name MongoDB -ErrorAction SilentlyContinue
if (-not $svc) { Write-Host '[p] No local MongoDB service found. Assuming MongoDB is already available.' }
elseif ($svc.Status -eq 'Running') { Write-Host '[p] MongoDB is already running.' }
else {
  Write-Host '[p] Starting the MongoDB service...'
  try { Start-Service -Name MongoDB -ErrorAction Stop; Write-Host '[p] MongoDB started.' }
  catch { Write-Warning ('[p] Could not start MongoDB (run this terminal as administrator). ' + $_.Exception.Message) }
}
`
if (process.platform === 'win32') {
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', startMongo], { stdio: 'inherit' })
} else {
  console.log('[p] Not on Windows, so MongoDB is not started for you.')
}

// 2. App + tunnel. Values set here win over .env (the API and Vite only fill in what is missing).
console.log(`[p] Open Jackal at ${ORIGIN}`)
console.log(`[p] Plaid must list ${ORIGIN}/plaid-oauth under Allowed redirect URIs.`)

const child = spawn(
  'npx concurrently --names web,api,tunnel --prefix-colors cyan,green,magenta --kill-others-on-fail "npm run dev" "npm run server" "npm run ngrok"',
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CLIENT_ORIGIN: ORIGIN, PLAID_REDIRECT_URI: `${ORIGIN}/plaid-oauth` },
  },
)
child.on('exit', (code) => process.exit(code ?? 0))
