// Usage: npm run dev:memory
// Runs the API against a throwaway in-memory MongoDB with a demo account and sample skills.
// Handy when MongoDB isn't installed. All data is lost when you stop it.
import { MongoMemoryServer } from 'mongodb-memory-server'

const mongod = await MongoMemoryServer.create()
process.env.MONGODB_URI = mongod.getUri('jackal-dev')

// Imported after MONGODB_URI is set, because config reads the environment on import.
const { createApp } = await import('../src/app.js')
const { hashPassword } = await import('../src/auth/password.js')
const { config } = await import('../src/config.js')
const { connectDb, disconnectDb } = await import('../src/db.js')
const { User, syncAllIndexes } = await import('../src/models.js')
const { seedSkills } = await import('../src/seed.js')

const DEMO_EMAIL = 'demo@jackal.local'
const DEMO_PASSWORD = 'demo-password-1'

await connectDb(config.mongoUri)
await syncAllIndexes()
const demo = await User.create({
  email: DEMO_EMAIL,
  name: 'Demo',
  passwordHash: await hashPassword(DEMO_PASSWORD),
})
await seedSkills(demo._id)

const server = createApp().listen(config.port, config.host, () => {
  console.log(`API (in-memory MongoDB, data is temporary) on http://${config.host}:${config.port}`)
  console.log(`Demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
})

const shutdown = async () => {
  server.close()
  await disconnectDb()
  await mongod.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
