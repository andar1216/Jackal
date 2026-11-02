import { Router } from 'express'
import { z } from 'zod'
import { catchUp, toggleLog } from '../lib/autoMark.js'
import { requireId } from '../lib/crud.js'
import { HttpError } from '../lib/errors.js'
import { goalsRouter } from '../lib/goalsRouter.js'
import { BoardLayout, ManualAccount, Meal, PhoneDevice, Skill, Transaction, User, Workout } from '../models.js'
import { dateString, layoutBody, layoutPageParam, mealSchema, skillSchema, workoutSchema } from '../validation.js'
import { crunchData, syncCrunch } from './crunch.js'
import { integrationList } from './list.js'
import { plaidAccounts } from './plaid.js'
import { saveCategory, screenTimeData } from './screenTime.js'
import { importHealth, importStrongFile } from './workoutImport.js'

/**
 * What the Android app shows besides sending screen time: the habits, Screen Time and Finances screens. It is mounted
 * behind the phone's key (see phone.ts), reads only this person's data, and offers just what the phone screens need.
 */
export const phoneDataRouter = Router()

const ownerOf = (res: { locals: Record<string, unknown> }) => String((res.locals.device as InstanceType<typeof PhoneDevice>).userId)

const today = z.object({ today: dateString.optional() })
const todayOf = (query: unknown) => today.parse(query).today ?? new Date().toLocaleDateString('en-CA')

/* ---------- Who it is ---------- */

// The name and email of the account this phone belongs to, for the profile at the bottom of the phone's menu.
phoneDataRouter.get('/me', async (_req, res) => {
  const user = await User.findById(ownerOf(res)).select('name email').lean()
  if (!user) throw new HttpError(404, 'Not found')
  res.json({ name: user.name, email: user.email })
})

/* ---------- Habits ---------- */

// The habits, with the days each was done. The ones that mark themselves are caught up first, like on the website.
phoneDataRouter.get('/habits', async (req, res) => {
  const userId = ownerOf(res)
  const day = todayOf(req.query)
  const habits = await Skill.find({ userId }).sort({ createdAt: 1 })
  for (const habit of habits) if (habit.autoMark && catchUp(habit, day)) await habit.save()
  res.json(habits)
})

// Puts one day on or off for a habit, like tapping a day in the habits calendar.
phoneDataRouter.post('/habits/:id/toggle/:date', async (req, res) => {
  const date = dateString.parse(req.params.date)
  const habit = await Skill.findOne({ _id: requireId(req.params.id), userId: ownerOf(res) })
  if (!habit) throw new HttpError(404, 'Not found')
  toggleLog(habit, date)
  await habit.save()
  res.json(habit)
})

// A new habit, started today (the phone's today).
phoneDataRouter.post('/habits', async (req, res) => {
  const { name, kind, color } = skillSchema.pick({ name: true, kind: true, color: true }).parse(req.body)
  const habit = await Skill.create({ name, kind, color, startDate: todayOf(req.query), userId: ownerOf(res) })
  res.status(201).json(habit)
})

// Renames a habit, or puts it away (archived) and brings it back.
phoneDataRouter.patch('/habits/:id', async (req, res) => {
  const changes = skillSchema.pick({ name: true, archived: true }).partial().parse(req.body)
  const habit = await Skill.findOne({ _id: requireId(req.params.id), userId: ownerOf(res) })
  if (!habit) throw new HttpError(404, 'Not found')
  habit.set(changes)
  await habit.save()
  res.json(habit)
})

phoneDataRouter.delete('/habits/:id', async (req, res) => {
  const gone = await Skill.deleteOne({ _id: requireId(req.params.id), userId: ownerOf(res) })
  if (gone.deletedCount === 0) throw new HttpError(404, 'Not found')
  res.status(204).end()
})

/* ---------- Goals ---------- */

// The same goals and steps as the website, made and changed from the phone.
phoneDataRouter.use('/goals', goalsRouter((_req, res) => ownerOf(res)))

/* ---------- Diet and Fitness ---------- */

const span = z.object({ from: dateString.optional(), to: dateString.optional() })

/** The days asked for with ?from= and ?to=, or the last 30 days when none were. */
const daysAsked = (query: unknown) => {
  const { from, to } = span.parse(query)
  const fallback = new Date(Date.now() - 30 * 24 * 3600 * 1000).toLocaleDateString('en-CA')
  return { $gte: from ?? fallback, ...(to ? { $lte: to } : {}) }
}

phoneDataRouter.get('/meals', async (req, res) => {
  res.json(await Meal.find({ userId: ownerOf(res), date: daysAsked(req.query) }).sort({ date: -1, createdAt: 1 }))
})

phoneDataRouter.post('/meals', async (req, res) => {
  res.status(201).json(await Meal.create({ ...mealSchema.parse(req.body), userId: ownerOf(res) }))
})

phoneDataRouter.delete('/meals/:id', async (req, res) => {
  const gone = await Meal.deleteOne({ _id: requireId(req.params.id), userId: ownerOf(res) })
  if (gone.deletedCount === 0) throw new HttpError(404, 'Not found')
  res.status(204).end()
})

phoneDataRouter.get('/workouts', async (req, res) => {
  res.json(await Workout.find({ userId: ownerOf(res), date: daysAsked(req.query) }).sort({ date: -1, createdAt: 1 }))
})

phoneDataRouter.post('/workouts', async (req, res) => {
  res.status(201).json(await Workout.create({ ...workoutSchema.parse(req.body), userId: ownerOf(res) }))
})

// A Strong export (the CSV the phone picked), and the exercise sessions the phone read from Health Connect.
phoneDataRouter.post('/workouts/import-strong', async (req, res) => {
  res.json(await importStrongFile(ownerOf(res), req.body))
})

phoneDataRouter.post('/workouts/health', async (req, res) => {
  res.json(await importHealth(ownerOf(res), req.body))
})

phoneDataRouter.delete('/workouts/:id', async (req, res) => {
  const gone = await Workout.deleteOne({ _id: requireId(req.params.id), userId: ownerOf(res) })
  if (gone.deletedCount === 0) throw new HttpError(404, 'Not found')
  res.status(204).end()
})
// The fitness connectors (Crunch, MyFitnessPal) with whether each is connected, and Crunch's own data.
phoneDataRouter.get('/fitness', async (_req, res) => {
  const userId = ownerOf(res)
  const connectors = (await integrationList(userId)).filter((i) => i.category === 'fitness')
  res.json({ connectors, crunch: await crunchData(userId) })
})

// Refreshes Crunch from Crunch's site, like Sync now on the website.
phoneDataRouter.post('/fitness/crunch/sync', async (_req, res) => {
  res.json(await syncCrunch(ownerOf(res)))
})

/* ---------- Where the phone's boards sit ---------- */

// The phone keeps its own arrangement (a page called "phone-..."), apart from the website's pages of the same name.
const phonePage = layoutPageParam.refine((page) => page.startsWith('phone-'), "A phone page's name starts with phone-")

phoneDataRouter.get('/layouts', async (_req, res) => {
  const saved = await BoardLayout.find({ userId: ownerOf(res), page: /^phone-/ }).lean()
  res.json(Object.fromEntries(saved.map((l) => [l.page, l.items])))
})

phoneDataRouter.put('/layouts/:page', async (req, res) => {
  const page = phonePage.parse(req.params.page)
  const { items } = layoutBody.parse(req.body)
  await BoardLayout.updateOne({ userId: ownerOf(res), page }, { $set: { items } }, { upsert: true })
  res.status(204).end()
})

// Puts every phone page back the way it came.
phoneDataRouter.delete('/layouts', async (_req, res) => {
  await BoardLayout.deleteMany({ userId: ownerOf(res), page: /^phone-/ })
  res.status(204).end()
})

/* ---------- Screen Time ---------- */

const DAYS_FOR_PHONE = 45 // the phone's longest "last 30 days" plus some room, and it keeps the answer small

phoneDataRouter.get('/screen-time', async (_req, res) => {
  res.json(await screenTimeData(ownerOf(res), DAYS_FOR_PHONE))
})

// Files an app or website under a category, like on the website.
phoneDataRouter.put('/screen-time/category', async (req, res) => {
  await saveCategory(ownerOf(res), req.body)
  res.status(204).end()
})

/* ---------- Finances ---------- */

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })

type Tx = { _id: unknown; date: string; type: string; amountCents: number; category: string; note?: string | null; isRefund?: boolean | null; accountName?: string | null }

// Money that went out. A refund onto a card lowers it.
const spend = (t: { type: string; isRefund?: boolean | null; amountCents: number }) => (t.type !== 'expense' ? 0 : t.isRefund ? -t.amountCents : t.amountCents)

phoneDataRouter.get('/finance', async (req, res) => {
  const userId = ownerOf(res)
  const month = monthQuery.parse(req.query).month ?? new Date().toLocaleDateString('en-CA').slice(0, 7)

  const [bank, manual, inMonth, recent] = await Promise.all([
    plaidAccounts(userId),
    ManualAccount.find({ userId }).sort({ createdAt: 1 }),
    Transaction.find({ userId, archived: { $ne: true }, date: { $gte: `${month}-01`, $lte: `${month}-31` } }).lean<Tx[]>(),
    Transaction.find({ userId, archived: { $ne: true } }).sort({ date: -1, createdAt: -1 }).limit(60).lean<Tx[]>(),
  ])

  const accounts = [
    ...bank.map((a) => {
      const debt = a.type === 'credit' || a.type === 'loan'
      const tag = a.type === 'credit' ? 'Credit card' : a.type === 'loan' ? 'Loan' : a.type === 'investment' ? 'Investment' : 'Bank account'
      return { name: a.label, tag, debt, balanceCents: a.balanceCents ?? null }
    }),
    ...manual.map((m) => ({
      name: m.mask ? `${m.name} ••${m.mask}` : m.name,
      tag: m.kind === 'credit' ? 'Credit card' : 'Bank account',
      debt: m.kind === 'credit',
      balanceCents: m.balanceCents ?? null,
    })),
  ].sort((a, b) => Number(a.debt) - Number(b.debt) || a.name.localeCompare(b.name))

  const counted = accounts.filter((a) => a.balanceCents !== null)
  const assetsCents = counted.filter((a) => !a.debt).reduce((s, a) => s + (a.balanceCents ?? 0), 0)
  const debtsCents = counted.filter((a) => a.debt).reduce((s, a) => s + (a.balanceCents ?? 0), 0)

  const byCategory = new Map<string, number>()
  for (const t of inMonth) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + spend(t))

  res.json({
    month,
    accounts,
    assetsCents,
    debtsCents,
    netCents: assetsCents - debtsCents,
    withoutBalance: accounts.length - counted.length,
    incomeCents: inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0),
    spentCents: inMonth.reduce((s, t) => s + spend(t), 0),
    categories: [...byCategory.entries()].filter(([, cents]) => cents > 0).map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
    recent: recent.map((t) => ({
      id: String(t._id),
      date: t.date,
      type: t.type,
      amountCents: t.amountCents,
      category: t.category,
      note: t.note ?? '',
      isRefund: !!t.isRefund,
      accountName: t.accountName ?? '',
    })),
  })
})
