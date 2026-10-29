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
  // Logged ("on") days, kept unique and sorted.
  logs: z
    .array(dateString)
    .transform((days) => [...new Set(days)].sort())
    .optional(),
  avgWeeks: z.number().int().min(1).max(52).optional(),
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
})

export const accountViewSchema = z.strictObject({
  name,
  accounts: z.array(z.string().trim().min(1).max(200)).max(200),
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
