import { Router } from 'express'
import { z } from 'zod'
import { catchUp, toggleLog } from '../lib/autoMark.js'
import { requireId } from '../lib/crud.js'
import { HttpError } from '../lib/errors.js'
import { ManualAccount, PhoneDevice, Skill, Transaction } from '../models.js'
import { dateString } from '../validation.js'
import { plaidAccounts } from './plaid.js'
import { saveCategory, screenTimeData } from './screenTime.js'

/**
 * What the Android app shows besides sending screen time: the habits, Screen Time and Finances screens. It is mounted
 * behind the phone's key (see phone.ts), reads only this person's data, and offers just what the phone screens need.
 */
export const phoneDataRouter = Router()

const ownerOf = (res: { locals: Record<string, unknown> }) => String((res.locals.device as InstanceType<typeof PhoneDevice>).userId)

const today = z.object({ today: dateString.optional() })
const todayOf = (query: unknown) => today.parse(query).today ?? new Date().toLocaleDateString('en-CA')

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
