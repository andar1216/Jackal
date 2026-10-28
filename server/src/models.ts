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
        delete ret.userId // the owner is never sent to the client
        return ret
      },
    },
  })
}

/** Like makeSchema, but every document belongs to one user. */
const ownedSchema = (definition: SchemaDefinition) =>
  makeSchema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ...definition,
  })

const day = { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true }

/* ---------- Accounts ---------- */

export const User = mongoose.model(
  'User',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      name: { type: String, required: true, trim: true },
      passwordHash: { type: String, required: true },
    },
    { timestamps: true },
  ),
)

export const Session = mongoose.model(
  'Session',
  new Schema(
    {
      tokenHash: { type: String, required: true, unique: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      // MongoDB deletes the document itself once this time passes.
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
    },
    { timestamps: true },
  ),
)

/* ---------- Each user's data ---------- */

export const Skill = mongoose.model(
  'Skill',
  ownedSchema({
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#4f46e5' },
    startDate: day,
    logs: { type: [String], default: [] }, // YYYY-MM-DD days the skill was practiced
    avgWeeks: { type: Number, default: 12, min: 1, max: 52 },
  }),
)

export const Tracker = mongoose.model(
  'Tracker',
  ownedSchema({
    name: { type: String, required: true, trim: true },
    startDate: day,
    color: { type: String, default: '#4f46e5' },
    notes: String,
  }),
)

const transactionSchema = ownedSchema({
  type: { type: String, enum: ['income', 'expense'], required: true },
  amountCents: { type: Number, required: true, min: 1 },
  category: { type: String, required: true, trim: true, index: true },
  date: day,
  note: String,
  // Where it came from. Imported bank transactions carry the bank's own id so syncing twice never duplicates.
  source: { type: String, enum: ['manual', 'plaid'], default: 'manual' },
  externalId: String,
  accountName: String, // for bank imports: bank, account and last digits
  accountId: String,
  // A credit given back on a credit card (return, refund). It lowers spending instead of counting as income.
  isRefund: { type: Boolean, default: false },
})
transactionSchema.index(
  { userId: 1, source: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
)
export const Transaction = mongoose.model('Transaction', transactionSchema)

export const Meal = mongoose.model(
  'Meal',
  ownedSchema({
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
  ownedSchema({
    type: { type: String, required: true, trim: true },
    durationMin: { type: Number, required: true, min: 1 },
    caloriesBurned: { type: Number, default: 0, min: 0 },
    date: { ...day, default: today },
  }),
)

export const TimeEntry = mongoose.model(
  'TimeEntry',
  ownedSchema({
    label: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    start: { type: Date, required: true, index: true },
    end: Date, // unset while the timer is running
  }),
)

export const CalendarEvent = mongoose.model(
  'CalendarEvent',
  ownedSchema({
    title: { type: String, required: true, trim: true },
    date: day,
  }),
)

/** One document per connected outside service (see integrations/registry.ts), per user. */
const connectionSchema = ownedSchema({
  provider: { type: String, required: true },
  connectedAt: { type: Date, default: Date.now },
  accountLabel: String, // for example the Google account email
  // Tokens and other secrets will be added here, encrypted, when the first integration is built.
})
connectionSchema.index({ userId: 1, provider: 1 }, { unique: true })
export const Connection = mongoose.model('Connection', connectionSchema)

/** One connected bank (a Plaid \Item\) per document. The access token is stored encrypted and never sent to the browser. */
export const PlaidItem = mongoose.model(
  'PlaidItem',
  ownedSchema({
    itemId: { type: String, required: true, unique: true },
    institutionName: { type: String, default: 'Bank' },
    accessToken: { type: String, required: true, select: false }, // encrypted, see lib/secrets.ts
    cursor: String, // where the next transactions sync continues from
    lastSyncedAt: Date,
    accounts: {
      // `type` has to be spelled out, because Mongoose reads a bare `type` key as "the type of this whole object".
      type: [{ _id: false, accountId: String, name: String, mask: String, type: { type: String }, subtype: String }],
      default: [],
    },
    // Bumped when how we import changes, so older imports get fetched again once.
    syncVersion: Number,
  }),
)

/** Every model that belongs to a user. */
export const ownedModels = [Skill, Tracker, Transaction, Meal, Workout, TimeEntry, CalendarEvent, Connection, PlaidItem]

/**
 * Data created before accounts existed has no owner. The first account to be created inherits it.
 */
export async function adoptOrphanedData(userId: unknown) {
  for (const model of ownedModels) {
    await model.collection.updateMany({ userId: { $exists: false } }, { $set: { userId } })
  }
}

/** Create missing indexes and drop stale ones (for example the old one-per-provider rule). */
export const syncAllIndexes = () => Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()))
