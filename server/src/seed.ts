import { Skill } from './models.js'

const dayKey = (daysAgo: number) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

/** Log every day (counting back from today) where `pattern(daysAgo)` is true. */
const logs = (daysBack: number, pattern: (daysAgo: number) => boolean) =>
  Array.from({ length: daysBack + 1 }, (_, i) => i)
    .filter(pattern)
    .map(dayKey)
    .sort()

/** Insert the default sample skills, but only if there are none yet. Returns how many were added. */
export async function seedSkills() {
  if ((await Skill.countDocuments()) > 0) return 0

  await Skill.create([
    {
      name: 'Exercise',
      color: '#4f46e5',
      startDate: dayKey(100),
      logs: logs(100, (i) => i !== 0 && i % 8 !== 7),
      avgWeeks: 12,
    },
    {
      name: 'Calories',
      color: '#db2777',
      startDate: dayKey(60),
      logs: logs(60, (i) => i % 2 === 0 || i % 5 === 0),
      avgWeeks: 8,
    },
    {
      name: 'Finances',
      color: '#0891b2',
      startDate: dayKey(30),
      logs: logs(30, (i) => i % 3 !== 0),
      avgWeeks: 4,
    },
  ])
  return 3
}
