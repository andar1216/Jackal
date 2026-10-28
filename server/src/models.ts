import mongoose, { Schema, type SchemaDefinition } from 'mongoose'

/** Today as YYYY-MM-DD in the server's local time. */
const today = () => new Date().toLocaleDateString('en-CA')

/**
 * Build a schema whose JSON output matches the frontend types:
 * `_id` becomes a string `id`, and `__v` is dropped.
 */
function makeSchema(definition: SchemaDefinition) {
  return new Schema(definition, {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  })
}

const day = { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true }

export const Skill = mongoose.model(
  'Skill',
  makeSchema({
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#4f46e5' },
    startDate: day,
    logs: { type: [String], default: [] }, // YYYY-MM-DD days the skill was practiced
    avgWeeks: { type: Number, default: 12, min: 1, max: 52 },
  }),
)

export const Tracker = mongoose.model(
  'Tracker',
  makeSchema({
    name: { type: String, required: true, trim: true },
    startDate: day,
    color: { type: String, default: '#4f46e5' },
    notes: String,
  }),
)

export const Transaction = mongoose.model(
  'Transaction',
  makeSchema({
    type: { type: String, enum: ['income', 'expense'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    category: { type: String, required: true, trim: true, index: true },
    date: day,
    note: String,
  }),
)

export const Meal = mongoose.model(
  'Meal',
  makeSchema({
    name: { type: String, required: true, trim: true },
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, default: 0, min: 0 },
    carbs: { type: Number, default: 0, min: 0 },
    fat: { type: Number, default: 0, min: 0 },
    date: { ...day, default: today },
  }),
)

export const Workout = mongoose.model(
  'Workout',
  makeSchema({
    type: { type: String, required: true, trim: true },
    durationMin: { type: Number, required: true, min: 1 },
    caloriesBurned: { type: Number, default: 0, min: 0 },
    date: { ...day, default: today },
  }),
)

export const TimeEntry = mongoose.model(
  'TimeEntry',
  makeSchema({
    label: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    start: { type: Date, required: true, index: true },
    end: Date, // unset while the timer is running
  }),
)

/** One document per connected outside service (see integrations/registry.ts). */
export const Connection = mongoose.model(
  'Connection',
  makeSchema({
    provider: { type: String, required: true, unique: true },
    connectedAt: { type: Date, default: Date.now },
    accountLabel: String, // for example the Google account email
    // Tokens and other secrets will be added here, encrypted, when the first integration is built.
  }),
)

export const CalendarEvent = mongoose.model(
  'CalendarEvent',
  makeSchema({
    title: { type: String, required: true, trim: true },
    date: day,
  }),
)
