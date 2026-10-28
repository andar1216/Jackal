import { createApp } from './app.js'
import { config } from './config.js'
import { connectDb, disconnectDb } from './db.js'

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

async function main() {
  await connectWithRetry()
  console.log('Connected to MongoDB')

  const server = createApp().listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`)
  })

  const shutdown = () => {
    server.close(() => void disconnectDb().then(() => process.exit(0)))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
