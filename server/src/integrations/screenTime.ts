import { Router } from 'express'
import { currentUserId } from '../auth/middleware.js'
import { z } from 'zod'
import { ScreenTimeSite, ScreenTimeUsage } from '../models.js'
import { iconSources } from './icons.js'

/** What the Screen Time page reads. The numbers come from ActivityWatch (see activityWatch.ts). */
export const screenTimeRouter = Router()

const HISTORY_DAYS = 90

// The last 90 days of totals, one row per day and app, and one per day and website.
screenTimeRouter.get('/data', async (req, res) => {
  const userId = currentUserId(req)
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 3600 * 1000).toLocaleDateString('en-CA')
  const [usage, sites] = await Promise.all([
    ScreenTimeUsage.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(50000),
    ScreenTimeSite.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(50000),
  ])
  res.json({
    usage: usage.map((u) => ({ device: u.device, day: u.day, app: u.app, seconds: u.seconds })),
    sites: sites.map((s) => ({ device: s.device, day: s.day, site: s.site, seconds: s.seconds })),
  })
})

const iconQuery = z.object({ kind: z.enum(['site', 'app']), name: z.string().trim().min(1).max(120) })

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
  const { kind, name } = parsed.data
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