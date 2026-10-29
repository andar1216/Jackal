import { Router } from 'express'
import { auth } from './auth/routes.js'
import { currentUserId, requireAuth } from './auth/middleware.js'
import { integrations } from './integrations/routes.js'
import { crudRouter, requireId } from './lib/crud.js'
import { HttpError } from './lib/errors.js'
import { detectRecurring, markId, merchantKey, type Charge, type Mark } from './lib/recurring.js'
import { AccountView, CalendarEvent, ManualAccount, Meal, Skill, SubscriptionMark, TimeEntry, Tracker, Transaction, Workout } from './models.js'
import {
  accountViewSchema,
  dateString,
  eventSchema,
  manualAccountSchema,
  mealSchema,
  skillSchema,
  timeEntrySchema,
  subscriptionMarkBody,
  trackerSchema,
  transactionSchema,
  workoutSchema,
} from './validation.js'

export const api = Router()

// Sign-up and sign-in are public. Everything below this line needs a signed-in user.
api.use('/auth', auth)
api.use(requireAuth)

api.use('/integrations', integrations)

/* ---------- Skills (dashboard) ---------- */

const skills = crudRouter(Skill, { schema: skillSchema, sort: { createdAt: 1 } })

// Toggle one day on or off for a skill, like clicking a day in the dashboard calendar.
// Logging a day before the skill's start date moves the start date back to that day.
skills.post('/:id/logs/:date/toggle', async (req, res) => {
  const date = dateString.parse(req.params.date)
  const skill = await Skill.findOne({ _id: requireId(req.params.id), userId: currentUserId(req) })
  if (!skill) throw new HttpError(404, 'Not found')

  if (skill.logs.includes(date)) {
    skill.logs = skill.logs.filter((d: string) => d !== date)
  } else {
    skill.logs.push(date)
    skill.logs.sort()
    if (date < skill.startDate) skill.startDate = date
  }
  await skill.save()
  res.json(skill)
})

api.use('/skills', skills)

/* ---------- Everything else is plain CRUD ---------- */

api.use('/trackers', crudRouter(Tracker, { schema: trackerSchema, sort: { startDate: 1 } }))

api.use(
  '/transactions',
  crudRouter(Transaction, {
    schema: transactionSchema,
    filters: ['type', 'category'],
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: -1 },
  }),
)

// Repeating charges (subscriptions), found from the last 13 months of spending on each account.
api.get('/subscriptions', async (req, res) => {
  const todayStr = new Date().toLocaleDateString('en-CA')
  const since = new Date(Date.now() - 400 * 86_400_000).toLocaleDateString('en-CA')
  const charges = await Transaction.find({
    userId: currentUserId(req),
    type: 'expense',
    isRefund: { $ne: true },
    archived: { $ne: true },
    date: { $gte: since },
  })
    .select('note amountCents date accountName')
    .lean()
  const plain: Charge[] = charges.map((c) => ({ note: c.note, amountCents: c.amountCents, date: c.date, accountName: c.accountName }))

  const saved = await SubscriptionMark.find({ userId: currentUserId(req) }).lean()
  const marks = new Map<string, Mark>(saved.map((m) => [markId(m.account, m.key), m.status as Mark]))
  const names = new Map<string, string>(saved.map((m) => [markId(m.account, m.key), m.name]))
  res.json(detectRecurring(plain, todayStr, marks, names))
})

// Say a charge is a subscription, say it is not, or take back what was said ("clear").
api.put('/subscriptions/marks', async (req, res) => {
  const { account, name, status } = subscriptionMarkBody.parse(req.body)
  const key = merchantKey(name)
  if (!key) throw new HttpError(400, 'That charge has no merchant name to match on.')
  const owner = { userId: currentUserId(req), account, key }
  if (status === 'clear') await SubscriptionMark.deleteOne(owner)
  else await SubscriptionMark.updateOne(owner, { $set: { name, status } }, { upsert: true })
  res.status(204).end()
})

api.use('/views', crudRouter(AccountView, { schema: accountViewSchema, sort: { createdAt: 1 } }))

api.use('/accounts', crudRouter(ManualAccount, { schema: manualAccountSchema, sort: { createdAt: 1 } }))

api.use(
  '/meals',
  crudRouter(Meal, {
    schema: mealSchema,
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: 1 },
  }),
)

api.use(
  '/workouts',
  crudRouter(Workout, {
    schema: workoutSchema,
    filters: ['type'],
    range: { field: 'date', kind: 'day' },
    sort: { date: -1, createdAt: 1 },
  }),
)

// `from` / `to` here are full ISO timestamps, so the client can pass its own local day bounds.
api.use(
  '/time-entries',
  crudRouter(TimeEntry, {
    schema: timeEntrySchema,
    filters: ['category'],
    range: { field: 'start', kind: 'timestamp' },
    sort: { start: -1 },
  }),
)

api.use(
  '/events',
  crudRouter(CalendarEvent, {
    schema: eventSchema,
    range: { field: 'date', kind: 'day' },
    sort: { date: 1, createdAt: 1 },
  }),
)
