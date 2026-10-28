// Usage: npm run seed
// Adds the default skills (Exercise, Calories, Finances) if the skills collection is empty.
import { config } from '../src/config.js'
import { connectDb, disconnectDb } from '../src/db.js'
import { seedSkills } from '../src/seed.js'

await connectDb(config.mongoUri)
const added = await seedSkills()
console.log(added > 0 ? `Added ${added} default skills.` : 'Skills already exist, nothing to do.')
await disconnectDb()
