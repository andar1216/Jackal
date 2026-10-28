// Usage: npm run dev:memory
// Runs the API against a throwaway in-memory MongoDB, seeded with the default skills.
// Handy when MongoDB isn't installed. All data is lost when you stop it.
import { MongoMemoryServer } from 'mongodb-memory-server'

const mongod = await MongoMemoryServer.create()
process.env.MONGODB_URI = mongod.getUri('jackal-dev')

// Imported after MONGODB_URI is set, because config reads the environment on import.
const { createApp } = await import('../src/app.js')
const { config } = await import('../src/config.js')
const { connectDb, disconnectDb } = await import('../src/db.js')
const { seedSkills } = await import('../src/seed.js')

await connectDb(config.mongoUri)
await seedSkills()

const server = createApp().listen(config.port, () => {
  console.log(`API (in-memory MongoDB, data is temporary) on http://localhost:${config.port}`)
})

const shutdown = async () => {
  server.close()
  await disconnectDb()
  await mongod.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
