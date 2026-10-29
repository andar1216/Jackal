import { createApp } from './app.js'
import { config } from './config.js'
import { connectDb, disconnectDb } from './db.js'
import { plaidGateway } from './integrations/plaidGateway.js'
import { syncAllIndexes } from './models.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Keep trying until MongoDB is reachable, so it can be started after the API (or in any order). */
async function connectWithRetry() {
  const shownUri = config.mongoUri.replace(/\/\/.*@/, '//***@')
  for (let attempt = 1; ; attempt++) {
    try {
      await connectDb(config.mongoUri)
      return
    } catch (err) {
      if (attempt === 1) {
        console.error(`Could not connect to MongoDB at ${shownUri}`)
        console.error((err as Error).message)
        console.error('Is MongoDB running? Check MONGODB_URI in .env (see .env.example). Retrying every 5s...')
      } else {
        console.error(`Still can't reach MongoDB (attempt ${attempt}). Retrying in 5s...`)
      }
      await sleep(5000)
    }
  }
}

/** Banks like Citi need the OAuth return address set up right. Say so at startup instead of failing in Link. */
function warnAboutRedirect() {
  const uri = config.plaid.redirectUri
  if (!uri) {
    console.log('Plaid OAuth: PLAID_REDIRECT_URI not set (banks that sign in on their own site, like Citi, will not link)')
    return
  }
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    console.warn(`Plaid OAuth: PLAID_REDIRECT_URI is not a valid address: ${uri}`)
    return
  }
  console.log(`Plaid OAuth: redirect ${uri}`)
  if (config.plaid.env === 'production' && url.protocol !== 'https:') {
    console.warn('Plaid OAuth: production requires an https PLAID_REDIRECT_URI. Plaid will reject this one.')
  }
  if (url.pathname !== '/plaid-oauth') {
    console.warn('Plaid OAuth: the address should end in /plaid-oauth, the page that finishes the link.')
  }
  if (url.origin !== config.clientOrigin) {
    console.warn(`Plaid OAuth: CLIENT_ORIGIN should be ${url.origin} while linking through it, or sign-in and saving will be refused.`)
  }
}

async function main() {
  await connectWithRetry()
  console.log('Connected to MongoDB')
  await syncAllIndexes()

  const server = createApp().listen(config.port, config.host, () => {
    console.log(`API listening on http://${config.host}:${config.port}`)
    // Which Plaid environment is active (never the keys themselves), so a wrong .env is easy to spot.
    console.log(`Plaid: ${config.plaid.env} (${plaidGateway().isConfigured() ? 'keys found' : 'NOT set up'})`)
    warnAboutRedirect()
  })

  const shutdown = () => {
    server.close(() => void disconnectDb().then(() => process.exit(0)))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
