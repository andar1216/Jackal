// Usage: npm run seed [-- you@example.com]
// Adds the default skills (Exercise, Calories, Finances) to an account that has none.
// With no email it uses the first account created.
import { config } from '../src/config.js'
import { connectDb, disconnectDb } from '../src/db.js'
import { User } from '../src/models.js'
import { seedSkills } from '../src/seed.js'

await connectDb(config.mongoUri)

const email = process.argv[2]?.trim().toLowerCase()
const user = email ? await User.findOne({ email }) : await User.findOne().sort({ createdAt: 1 })

if (!user) {
  console.log(email ? `No account found for ${email}.` : 'No accounts yet. Sign up in the app first, then run this again.')
  process.exitCode = 1
} else {
  const added = await seedSkills(user._id)
  console.log(added > 0 ? `Added ${added} default skills to ${user.email}.` : `${user.email} already has skills, nothing to do.`)
}

await disconnectDb()
