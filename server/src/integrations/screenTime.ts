import { createHash, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { Router } from 'express'
import { z } from 'zod'
import { currentUserId } from '../auth/middleware.js'
import { config } from '../config.js'
import { HttpError } from '../lib/errors.js'
import { Connection, ScreenTimeDevice, ScreenTimeSite, ScreenTimeToken, ScreenTimeUsage } from '../models.js'
import { agentControl } from './localAgent.js'

/** The provider id the Connectors list uses for the computer agent. */
export const COMPUTER_PROVIDER = 'windows-screen-time'

const TOKEN_DAYS = 365
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** What the Screen Time page uses, behind the usual sign-in. */
export const screenTimeRouter = Router()

type Purpose = 'agent' | 'extension'

// Makes the secret the agent (or the Chrome extension) is set up with. A new one replaces the old, so an old install stops being accepted.
async function makeToken(userId: unknown, purpose: Purpose) {
  const token = randomBytes(32).toString('base64url')
  await ScreenTimeToken.findOneAndUpdate(
    { userId, purpose },
    { tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_DAYS * 24 * 3600 * 1000) },
    { upsert: true },
  )
  return token
}

screenTimeRouter.post('/token', async (req, res) => {
  const { purpose } = z.object({ purpose: z.enum(['agent', 'extension']).default('agent') }).parse(req.body ?? {})
  const token = await makeToken(currentUserId(req), purpose)
  // The extension is told which computer it is on, so its websites line up with the agent's apps.
  res.status(201).json({ token, device: hostname() })
})

/* ---------- Running the agent on this computer, from the page ---------- */

const agentFailed = (err: unknown) => new HttpError(500, err instanceof Error ? err.message : 'Could not do that.')

screenTimeRouter.get('/agent', (_req, res) => {
  res.json(agentControl.status())
})

// "Run agent": a fresh secret, handed straight to the agent, so there is nothing to copy.
screenTimeRouter.post('/agent/start', async (req, res) => {
  const token = await makeToken(currentUserId(req), 'agent')
  try {
    await agentControl.start({ server: `http://127.0.0.1:${config.port}`, token, device: hostname() })
  } catch (err) {
    throw agentFailed(err)
  }
  res.json(agentControl.status())
})

screenTimeRouter.post('/agent/stop', async (_req, res) => {
  try {
    await agentControl.stop()
  } catch (err) {
    throw agentFailed(err)
  }
  res.json(agentControl.status())
})

screenTimeRouter.put('/agent/startup', (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
  try {
    agentControl.setStartup(enabled)
  } catch (err) {
    throw agentFailed(err)
  }
  res.json(agentControl.status())
})

const HISTORY_DAYS = 90

// The devices and the last 90 days of totals, one row per device, day and app.
screenTimeRouter.get('/data', async (req, res) => {
  const userId = currentUserId(req)
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 3600 * 1000).toLocaleDateString('en-CA')
  const [devices, usage, sites] = await Promise.all([
    ScreenTimeDevice.find({ userId }).sort({ name: 1 }),
    ScreenTimeUsage.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(50000),
    ScreenTimeSite.find({ userId, day: { $gte: since } }).sort({ day: -1 }).limit(50000),
  ])
  res.json({
    devices: devices.map((d) => ({ name: d.name, kind: d.kind ?? 'computer', lastSeenAt: d.lastSeenAt ?? null, webSeenAt: d.webSeenAt ?? null })),
    usage: usage.map((u) => ({ device: u.device, day: u.day, app: u.app, seconds: u.seconds })),
    sites: sites.map((s) => ({ device: s.device, day: s.day, site: s.site, seconds: s.seconds })),
  })
})

// Stop tracking one computer and forget what it sent.
screenTimeRouter.delete('/devices/:name', async (req, res) => {
  const userId = currentUserId(req)
  const name = req.params.name
  await Promise.all([
    ScreenTimeDevice.deleteOne({ userId, name }),
    ScreenTimeUsage.deleteMany({ userId, device: name }),
    ScreenTimeSite.deleteMany({ userId, device: name }),
  ])
  if ((await ScreenTimeDevice.countDocuments({ userId })) === 0) await Connection.deleteOne({ userId, provider: COMPUTER_PROVIDER })
  res.status(204).end()
})

/** Forget the secret, every computer and everything they sent. */
export async function disconnectScreenTime(userId: unknown) {
  // Also stop the agent here, if it is running on this computer, so it is not left counting for nobody.
  await agentControl.stop().catch(() => undefined)
  await Promise.all([
    ScreenTimeToken.deleteMany({ userId }),
    ScreenTimeDevice.deleteMany({ userId }),
    ScreenTimeUsage.deleteMany({ userId }),
    ScreenTimeSite.deleteMany({ userId }),
    Connection.deleteOne({ userId, provider: COMPUTER_PROVIDER }),
  ])
}

const reportSchema = z.object({
  device: z.string().trim().min(1).max(60),
  days: z
    .array(
      z.object({
        day: dayKey,
        apps: z
          .array(z.object({ app: z.string().trim().min(1).max(120), seconds: z.number().int().min(0).max(86400) }))
          .max(500),
      }),
    )
    .max(14),
})

/**
 * Called by the agent running on the computer, so it is mounted in app.ts ahead of the sign-in and same-origin checks
 * (it is not a browser) and proves who it is with its secret.
 */
export const screenTimeAgentRouter = Router()

/** Checks the secret on a report from the agent or the extension, and says whose it is. */
async function whoSent(authorization: string | undefined, purpose: Purpose) {
  const header = authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const record = token ? await ScreenTimeToken.findOne({ tokenHash: sha256(token) }) : null
  if (!record || record.expiresAt.getTime() < Date.now() || (record.purpose ?? 'agent') !== purpose) {
    throw new HttpError(401, `This ${purpose === 'agent' ? 'agent' : 'extension'} is out of date. Open Screen Time in Valkyrie and set it up again.`)
  }
  return record.userId
}

screenTimeAgentRouter.post('/usage', async (req, res) => {
  const userId = await whoSent(req.headers.authorization, 'agent')
  const body = reportSchema.parse(req.body)

  await ScreenTimeDevice.findOneAndUpdate({ userId, name: body.device }, { lastSeenAt: new Date(), kind: 'computer' }, { upsert: true })
  await Connection.findOneAndUpdate(
    { userId, provider: COMPUTER_PROVIDER },
    { $setOnInsert: { accountLabel: 'Computer agent', connectedAt: new Date() } },
    { upsert: true },
  )

  // A day's total only goes up, so a late or repeated report can never shrink it.
  const ops = body.days.flatMap((d) =>
    d.apps.map((a) => ({
      updateOne: {
        filter: { userId, device: body.device, day: d.day, app: a.app },
        update: { $max: { seconds: a.seconds } },
        upsert: true,
      },
    })),
  )
  if (ops.length) await ScreenTimeUsage.bulkWrite(ops)
  res.json({ days: body.days.length, apps: ops.length })
})

const webSchema = z.object({
  device: z.string().trim().min(1).max(60),
  days: z
    .array(
      z.object({
        day: dayKey,
        sites: z
          .array(z.object({ site: z.string().trim().toLowerCase().min(1).max(120), seconds: z.number().int().min(0).max(86400) }))
          .max(500),
      }),
    )
    .max(14),
})

// Time on each website, from the Chrome extension. Same rules: the secret decides who it is, totals only go up.
screenTimeAgentRouter.post('/web', async (req, res) => {
  const userId = await whoSent(req.headers.authorization, 'extension')
  const body = webSchema.parse(req.body)

  await ScreenTimeDevice.findOneAndUpdate({ userId, name: body.device }, { webSeenAt: new Date(), $setOnInsert: { kind: 'computer' } }, { upsert: true })
  const ops = body.days.flatMap((d) =>
    d.sites.map((s) => ({
      updateOne: {
        filter: { userId, device: body.device, day: d.day, site: s.site },
        update: { $max: { seconds: s.seconds } },
        upsert: true,
      },
    })),
  )
  if (ops.length) await ScreenTimeSite.bulkWrite(ops)
  res.json({ days: body.days.length, sites: ops.length })
})