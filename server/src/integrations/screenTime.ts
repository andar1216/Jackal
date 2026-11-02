import { Router } from 'express'
import { currentUserId } from '../auth/middleware.js'
import { z } from 'zod'
import { AppCategory, PhoneDay, PhoneIcon, ScreenTimeSite, ScreenTimeSlot, ScreenTimeUsage } from '../models.js'
import { dateString } from '../validation.js'
import { iconSources } from './icons.js'

/** What the Screen Time page reads. The numbers come from ActivityWatch (see activityWatch.ts). */
export const screenTimeRouter = Router()

const HISTORY_DAYS = 1100

// Up to the last three years of totals, one row per day and app, and one per day and website.
/** What the Screen Time page shows, for the last days days. The phone app asks for fewer. */
export async function screenTimeData(userId: string, days = HISTORY_DAYS) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toLocaleDateString('en-CA')
  const [usage, sites, phoneDays, categories] = await Promise.all([
    ScreenTimeUsage.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(200000),
    ScreenTimeSite.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(200000),
    PhoneDay.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(5000),
    AppCategory.find({ userId }).limit(20000),
  ])
  return {
    usage: usage.map((u) => ({ device: u.device, kind: u.source === 'phone' ? 'phone' : 'computer', day: u.day, app: u.app, seconds: u.seconds })),
    sites: sites.map((s) => ({ device: s.device, kind: 'computer', day: s.day, site: s.site, seconds: s.seconds })),
    // What each app or website is filed under: what the person chose (`mine`) and what Android says (`phone`).
    categories: categories.map((c) => ({ kind: c.kind, name: c.name, mine: c.mine ?? null, phone: c.phone ?? null })),
    // Phone unlocks and the notifications each app sent, one entry per phone and day.
    phoneDays: phoneDays.map((p) => ({ device: p.device, day: p.day, unlocks: p.unlocks, notifications: p.notifications.map((n: { app: string; count: number }) => ({ app: n.app, count: n.count })) })),
  }
}

/** When each app and website was on screen on one day, by quarter hour (see lib/slots.ts), on every device. */
export async function slotsForDay(userId: string, day: string) {
  const rows = await ScreenTimeSlot.find({ userId, day }).limit(5000).lean()
  return rows.map((r) => ({
    device: r.device,
    kind: r.source === 'phone' ? 'phone' : 'computer',
    type: r.type,
    name: r.name,
    slots: r.slots.map((s: { q: number; seconds: number }) => ({ q: s.q, seconds: s.seconds })),
  }))
}

screenTimeRouter.get('/slots', async (req, res) => {
  res.json(await slotsForDay(currentUserId(req), dateString.parse(req.query.day)))
})

screenTimeRouter.get('/data', async (req, res) => {
  res.json(await screenTimeData(currentUserId(req)))
})

export const categoryBody = z.strictObject({
  kind: z.enum(['app', 'site']),
  name: z.string().trim().min(1).max(120),
  // null puts it back to automatic
  category: z.string().trim().min(1).max(40).nullable(),
})

/** Files an app or website under a category the person chose, or puts it back to automatic with null. */
export async function saveCategory(userId: string, body: unknown) {
  const { kind, name, category } = categoryBody.parse(body)
  if (category === null) {
    await AppCategory.updateOne({ userId, kind, name }, { $unset: { mine: '' } })
    await AppCategory.deleteOne({ userId, kind, name, mine: { $exists: false }, phone: { $exists: false } })
  } else {
    await AppCategory.updateOne({ userId, kind, name }, { $set: { mine: category } }, { upsert: true })
  }
}

screenTimeRouter.put('/category', async (req, res) => {
  await saveCategory(currentUserId(req), req.body)
  res.status(204).end()
})

const iconQuery = z.object({ kind: z.enum(['site', 'app']), name: z.string().trim().min(1).max(120), source: z.enum(['phone']).optional() })

// The small picture for one website or app in the lists. Only for names that are in your own totals, so this cannot be
// used to make the server fetch an address of someone's choosing. 404 means "no picture": the page shows a letter instead.
screenTimeRouter.get('/icon', async (req, res) => {
  const userId = currentUserId(req)
  const parsed = iconQuery.safeParse(req.query)
  const none = () => {
    res.setHeader('Cache-Control', 'private, max-age=1800')
    res.status(404).end()
  }
  if (!parsed.success) return none()
  const { kind, name, source } = parsed.data
  if (source === 'phone') {
    // A phone app's picture is the one the phone sent.
    const stored = kind === 'app' ? await PhoneIcon.findOne({ userId, app: name }) : null
    if (!stored) return none()
    res.setHeader('Content-Type', stored.type)
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(stored.data)
    return
  }
  const known = kind === 'site' ? await ScreenTimeSite.exists({ userId, site: name }) : await ScreenTimeUsage.exists({ userId, app: name })
  if (!known) return none()
  const icon = await (kind === 'site' ? iconSources.site(name.toLowerCase()) : iconSources.app(name))
  if (!icon) return none()
  res.setHeader('Content-Type', icon.type)
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox") // an SVG can never run anything
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=604800')
  res.send(icon.data)
})