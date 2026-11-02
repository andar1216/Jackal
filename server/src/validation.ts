import { z } from 'zod'

/** YYYY-MM-DD (a calendar day, no timezone). */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const name = z.string().trim().min(1).max(100)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #4f46e5')
const nonNegInt = z.number().int().min(0)

// Create schemas. Updates (PATCH) use `.partial()` of these.
// Defaults for omitted fields live in the Mongoose models.

export const skillSchema = z.strictObject({
  name,
  color: color.optional(),
  startDate: dateString,
  endDate: dateString.nullable().optional(), // goal end date; null takes it away
  // Logged ("on") days, kept unique and sorted.
  logs: z
    .array(dateString)
    .transform((days) => [...new Set(days)].sort())
    .optional(),
  avgWeeks: z.number().int().min(1).max(52).optional(),
  archived: z.boolean().optional(),
  autoMark: z.boolean().optional(),
  // Whether this habit's streak shows. Unset follows the page's hide-all / show-all choice; true or false overrides it.
  streakVisible: z.boolean().nullable().optional(),
  kind: z.enum(['performing', 'eliminating']).optional(),
})

export const trackerSchema = z.strictObject({
  name,
  startDate: dateString,
  color: color.optional(),
  notes: z.string().max(2000).optional(),
})

export const transactionSchema = z.strictObject({
  type: z.enum(['income', 'expense']),
  amountCents: z.number().int().positive(), // integer cents, never floats
  category: name,
  date: dateString,
  note: z.string().max(500).optional(),
  archived: z.boolean().optional(),
})

export const subscriptionMarkBody = z.strictObject({
  account: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  status: z.enum(['subscription', 'not', 'clear']),
})

const layoutId = z.string().trim().min(1).max(60)

export const layoutPageParam = z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/)

export const layoutBody = z.strictObject({
  items: z
    .array(z.strictObject({ id: layoutId, size: z.enum(['third', 'half', 'threeQuarters', 'full']), hidden: z.boolean(), height: z.number().int().min(60).max(1200).optional() }))
    .max(50)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'Each panel can be listed once.'),
})

export const accountViewSchema = z.strictObject({
  name,
  accounts: z.array(z.string().trim().min(1).max(200)).max(200),
})

export const deviceGroupSchema = z.strictObject({
  name,
  devices: z.array(z.string().trim().min(1).max(120)).max(50),
})

export const manualAccountSchema = z.strictObject({
  name,
  kind: z.enum(['bank', 'credit']),
  mask: z.string().trim().regex(/^\d{2,6}$/, 'Use the last 2 to 6 digits').optional(),
  balanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).optional(), // for a card, what is owed
})

export const mealSchema = z.strictObject({
  name,
  calories: nonNegInt,
  protein: nonNegInt.optional(),
  carbs: nonNegInt.optional(),
  fat: nonNegInt.optional(),
  date: dateString.optional(), // defaults to today
})

export const workoutSchema = z.strictObject({
  type: name,
  durationMin: z.number().int().positive(),
  caloriesBurned: nonNegInt.optional(),
  date: dateString.optional(), // defaults to today
})

export const timeEntrySchema = z.strictObject({
  label: name,
  category: name,
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }).optional(), // missing while the timer runs
})

export const eventSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  date: dateString,
})

/* ---------- Goals ---------- */

// A null takes the value away (no deadline, no cost); leaving it out leaves it as it was.
const minutes = z.number().int().min(0).max(5_256_000)
const cents = z.number().int().min(0).max(100_000_000_000)

export const goalTaskSchema = z.strictObject({
  title: name,
  notes: z.string().trim().max(1000).nullable().optional(),
  dueDate: dateString.nullable().optional(),
  costCents: cents.nullable().optional(),
  minutes: minutes.nullable().optional(),
  done: z.boolean().optional(),
})

export const goalSchema = z.strictObject({
  title: name,
  notes: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().max(40).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  color: color.optional(),
  startDate: dateString.optional(), // defaults to today
  dueDate: dateString.nullable().optional(),
  budgetCents: cents.nullable().optional(),
  budgetMinutes: minutes.nullable().optional(),
  status: z.enum(['active', 'paused', 'done']).optional(),
  tasks: z.array(goalTaskSchema).max(200).optional(), // only when a goal is made; steps are changed one by one after that
})
