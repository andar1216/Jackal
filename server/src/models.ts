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
    archived: { type: Boolean, default: false }, // put away: left out of the habits list and widgets until restored
    endDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }, // optional goal date: the day the habit is meant to run until
    kind: { type: String, enum: ['performing', 'eliminating'], default: 'performing' }, // doing something, or getting rid of something
    streakVisible: { type: Boolean }, // true or false overrides the page's hide-all / show-all; unset follows it
    autoMark: { type: Boolean, default: false }, // every day counts as done unless unmarked
    autoThrough: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }, // the last day autoMark has filled in
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
  // Hidden from Finances and left out of its totals. Never deleted, and syncing a bank leaves it alone.
  archived: { type: Boolean, default: false },
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
      type: [
        {
          _id: false,
          accountId: String,
          name: String,
          mask: String,
          type: { type: String },
          subtype: String,
          balanceCents: Number, // as of the last sync; owed amount for credit cards and loans
        },
      ],
      default: [],
    },
    // Bumped when how we import changes, so older imports get fetched again once.
    syncVersion: Number,
  }),
)

/** The person's Crunch member login (password stored encrypted, never sent to the browser) and the state of the last sync. */
const crunchLinkSchema = ownedSchema({
  // One login per person. Declared here, because ownedSchema already adds a plain index on userId and a second one clashes with it.
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  email: { type: String, trim: true }, // only when the person let Valkyrie sign in for them
  password: { type: String, select: false }, // encrypted, see lib/secrets.ts. Missing when the data was sent from the browser instead.
  // Whether Valkyrie can sign in and refresh by itself. Older links (made before this field) all had a password.
  autoSync: Boolean,
  memberId: { type: String, required: true },
  workoutGoal: Number, // check-ins per week, set on Crunch's site
  balanceCents: Number,
  lastSyncedAt: Date,
  lastError: String, // why the last sync failed, cleared by a good one
})
export const CrunchLink = mongoose.model('CrunchLink', crunchLinkSchema)

/** The secret in the "Send to Valkyrie" bookmark. It can only send Crunch data for this one person. Only a hash is kept. */
export const CrunchImportToken = mongoose.model(
  'CrunchImportToken',
  ownedSchema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // one at a time
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  }),
)

/** Everything imported from Crunch is replaced on each sync, so these hold no edits of ours. */
const crunchCheckInSchema = ownedSchema({
  externalId: { type: String, required: true },
  at: { type: Date, required: true, index: true },
  club: String,
})
crunchCheckInSchema.index({ userId: 1, externalId: 1 }, { unique: true })
export const CrunchCheckIn = mongoose.model('CrunchCheckIn', crunchCheckInSchema)

export const CrunchClass = mongoose.model(
  'CrunchClass',
  ownedSchema({
    program: { type: String, required: true },
    startsAt: { type: String, required: true, index: true }, // YYYY-MM-DDTHH:mm, club-local
    club: String,
    status: { type: String, required: true },
    feeCents: Number,
  }),
)

export const CrunchPayment = mongoose.model(
  'CrunchPayment',
  ownedSchema({
    service: { type: String, required: true },
    amountCents: { type: Number, required: true }, // charges positive, payments and credits negative
    date: day,
    club: String,
  }),
)

/** Every model that belongs to a user. */
/** A bank or card the person lists by hand (for example one Plaid can't reach yet). It shows up under Finances > By account. */
export const ManualAccount = mongoose.model(
  'ManualAccount',
  ownedSchema({
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['bank', 'credit'], required: true },
    mask: { type: String, trim: true }, // last digits, like "7946"
    balanceCents: Number, // typed in by hand; what is owed for a credit card
  }),
)

/** A named group of accounts, like "Business" or "Personal", for looking at part of your money at a time. Accounts are listed by the name Finances shows for them. */
export const AccountView = mongoose.model(
  'AccountView',
  ownedSchema({
    name: { type: String, required: true, trim: true },
    accounts: { type: [String], default: [] },
  }),
)

/** The person's say on a repeating charge: "subscription" forces it into Subscriptions, "not" hides it. Matched by account and merchant. */
const subscriptionMarkSchema = ownedSchema({
  account: { type: String, required: true },
  key: { type: String, required: true }, // the merchant, simplified (see lib/recurring.ts)
  name: { type: String, required: true }, // as it was shown, so a hidden one can be listed by name
  status: { type: String, enum: ['subscription', 'not'], required: true },
})
subscriptionMarkSchema.index({ userId: 1, account: 1, key: 1 }, { unique: true })
export const SubscriptionMark = mongoose.model('SubscriptionMark', subscriptionMarkSchema)

/** How the person arranged the panels on one page: the order, how wide each is, and which are put away. */
const boardLayoutSchema = ownedSchema({
  page: { type: String, required: true },
  items: {
    type: [
      new mongoose.Schema(
        {
          id: { type: String, required: true },
          size: { type: String, enum: ['third', 'half', 'full'], required: true },
          hidden: { type: Boolean, default: false },
        },
        { _id: false },
      ),
    ],
    default: [],
  },
})
boardLayoutSchema.index({ userId: 1, page: 1 }, { unique: true })
export const BoardLayout = mongoose.model('BoardLayout', boardLayoutSchema)

export const ownedModels = [Skill, Tracker, Transaction, Meal, Workout, TimeEntry, CalendarEvent, Connection, PlaidItem, ManualAccount, AccountView, SubscriptionMark, BoardLayout, CrunchLink, CrunchImportToken, CrunchCheckIn, CrunchClass, CrunchPayment]

/**
 * Data created before accounts existed has no owner. The first account to be created inherits it.
 */
export async function adoptOrphanedData(userId: unknown) {
  for (const model of ownedModels) {
    await model.collection.updateMany({ userId: { $exists: false } }, { $set: { userId } })
  }
}

/** Create missing indexes and drop stale ones (for example the old one-per-provider rule). */
/** Habits labelled before "Giving up" was renamed "Eliminating" are moved over. */
export const renameOldHabitKinds = () => Skill.updateMany({ kind: 'giving-up' }, { $set: { kind: 'eliminating' } })

/** Habits that had their streak hidden one by one (the old "hideStreak" flag) move to the new override. */
export const migrateStreakFlags = async () => {
  await Skill.collection.updateMany({ hideStreak: true }, { $set: { streakVisible: false }, $unset: { hideStreak: '' } })
  await Skill.collection.updateMany({ hideStreak: false }, { $unset: { hideStreak: '' } })
}

export const syncAllIndexes = () => Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()))
