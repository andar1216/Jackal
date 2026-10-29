import { Router, type Request } from 'express'
import { auth } from './auth/routes.js'
import { currentUserId, requireAuth } from './auth/middleware.js'
import { integrations } from './integrations/routes.js'
import { addDays, catchUp, daysFrom, mergeDays } from './lib/autoMark.js'
import { crudRouter, requireId } from './lib/crud.js'
import { HttpError } from './lib/errors.js'
import { detectRecurring, markId, merchantKey, type Charge, type Mark } from './lib/recurring.js'
import { AccountView, BoardLayout, CalendarEvent, ManualAccount, Meal, Skill, SubscriptionMark, TimeEntry, Tracker, Transaction, Workout } from './models.js'
import {
  accountViewSchema,
  dateString,
  eventSchema,
  layoutBody,
  layoutPageParam,
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

/* ---------- Skills (shown as Habits) ---------- */

const skills = Router()

// The person's own today (their clock, not the server's), so a habit isn't filled in a day early or late.
const todayFor = (req: Request) => {
  const asked = typeof req.query.today === 'string' ? dateString.safeParse(req.query.today) : null
  return asked?.success ? asked.data : new Date().toLocaleDateString('en-CA')
}

// Habits that mark themselves get the days since they were last opened filled in.
skills.get('/', async (req, _res, next) => {
  const today = todayFor(req)
  const auto = await Skill.find({ userId: currentUserId(req), autoMark: true })
  for (const habit of auto) if (catchUp(habit, today)) await habit.save()
  next()
})

const requireEndAfterStart = (doc: unknown) => {
  const habit = doc as { startDate: string; endDate?: string | null }
  if (habit.endDate && habit.endDate < habit.startDate) {
    throw new HttpError(400, "The goal end date can't be before the start date.")
  }
}

skills.post('/', async (req, res) => {
  const { autoMark, endDate, ...fields } = skillSchema.parse(req.body)
  const habit = new Skill({ ...fields, endDate: endDate ?? undefined, autoMark: !!autoMark, userId: currentUserId(req) })
  requireEndAfterStart(habit)
  if (autoMark) catchUp(habit, todayFor(req))
  await habit.save()
  res.status(201).json(habit)
})

skills.patch('/:id', async (req, res) => {
  const { autoMark, endDate, ...fields } = skillSchema.partial().parse(req.body)
  const habit = await Skill.findOne({ _id: requireId(req.params.id), userId: currentUserId(req) })
  if (!habit) throw new HttpError(404, 'Not found')

  const oldStart = habit.startDate
  habit.set(fields)
  if (endDate !== undefined) habit.endDate = endDate ?? undefined // null takes the goal date away
  requireEndAfterStart(habit)
  if (autoMark !== undefined && autoMark !== habit.autoMark) {
    habit.autoMark = autoMark
    habit.autoThrough = undefined // turning it on starts filling from the start date; turning it off stops
  }
  if (habit.autoMark) {
    // A start date moved earlier fills the days between the new start and the old one.
    if (habit.autoThrough && habit.startDate < oldStart) {
      const through = habit.autoThrough < addDays(oldStart, -1) ? habit.autoThrough : addDays(oldStart, -1)
      habit.logs = mergeDays(habit.logs, daysFrom(habit.startDate, through))
    }
    catchUp(habit, todayFor(req))
  }
  await habit.save()
  res.json(habit)
})

// Toggle one day on or off for a skill, like clicking a day in the habits calendar.
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

// Everything else (get one, delete) is plain CRUD.
skills.use(crudRouter(Skill, { schema: skillSchema, sort: { createdAt: 1 } }))

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

/* ---------- Page layouts ---------- */

// Every page's saved arrangement, keyed by page.
api.get('/layouts', async (req, res) => {
  const saved = await BoardLayout.find({ userId: currentUserId(req) }).lean()
  res.json(Object.fromEntries(saved.map((l) => [l.page, l.items])))
})

api.put('/layouts/:page', async (req, res) => {
  const page = layoutPageParam.parse(req.params.page)
  const { items } = layoutBody.parse(req.body)
  await BoardLayout.updateOne({ userId: currentUserId(req), page }, { $set: { items } }, { upsert: true })
  res.json(items)
})

// Put a page back to how it came.
api.delete('/layouts/:page', async (req, res) => {
  const page = layoutPageParam.parse(req.params.page)
  await BoardLayout.deleteOne({ userId: currentUserId(req), page })
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
