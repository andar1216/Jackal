import { createHash, randomBytes, randomInt } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { createAttemptLimiter, currentUserId } from '../auth/middleware.js'
import { config } from '../config.js'
import { HttpError } from '../lib/errors.js'
import { requireId } from '../lib/crud.js'
import { Connection, PhoneDay, PhoneDevice, PhoneIcon, PhonePairing, ScreenTimeUsage } from '../models.js'
import { dateString } from '../validation.js'

/**
 * Phone screen time. A small Valkyrie app on an Android phone (the `android/` folder) reads how long each app was open and
 * sends the daily totals here. Two sides:
 *  - `phoneRouter`: what the Screen Time page uses (signed in with the browser): make a pairing code, list and remove phones.
 *  - `phoneAppRouter`: what the phone app uses. It is mounted in app.ts ahead of the browser rules (cookie, same site) and
 *    proves itself with the secret key it got when it paired.
 */
export const PHONE_PROVIDER = 'samsung-screen-time'
export const PHONE_SOURCE = 'phone'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/* ---------- Pairing code ---------- */

// No 0/O/1/I, so a code read off the screen can't be mistyped as another.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_LENGTH = 8
const CODE_MINUTES = 10

const makeCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

/** The https address Valkyrie is reachable at from outside (an ngrok tunnel set in .env), if there is one. */
function publicAddress() {
  for (const candidate of [config.clientOrigin, config.plaid.redirectUri]) {
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:') return url.origin
    } catch {
      /* not set, or not an address */
    }
  }
  return undefined
}

/** Where the phone can reach this server: the secure public address first, then this computer on the home network. */
export function lanAddresses() {
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2)
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const [a, b] = i.address.split('.').map(Number)
      const isPrivate = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
      if (isPrivate) found.push(i.address)
    }
  }
  const lan = found.sort((x, y) => rank(x) - rank(y)).map((ip) => `http://${ip}:${config.port}`)
  const outside = publicAddress()
  return outside ? [outside, ...lan] : lan
}

/** False while the server only answers this computer and has no public address, so a phone could never reach it. */
const listensOnNetwork = () => !!publicAddress() || !['127.0.0.1', 'localhost', '::1'].includes(config.host)

/* ---------- Removing a phone ---------- */

async function removeDevices(userId: unknown, filter: { _id?: unknown } = {}) {
  const gone = await PhoneDevice.find({ userId, ...filter })
  if (!gone.length) return
  await Promise.all([
    PhoneDevice.deleteMany({ _id: { $in: gone.map((d) => d._id) } }),
    ScreenTimeUsage.deleteMany({ userId, source: PHONE_SOURCE, device: { $in: gone.map((d) => d.name) } }),
    PhoneDay.deleteMany({ userId, device: { $in: gone.map((d) => d.name) } }),
  ])
  // Nothing left on the phone side: forget the connection, the code and the pictures too.
  if (!(await PhoneDevice.exists({ userId }))) {
    await Promise.all([
      Connection.deleteOne({ userId, provider: PHONE_PROVIDER }),
      PhonePairing.deleteMany({ userId }),
      PhoneIcon.deleteMany({ userId }),
    ])
  }
}

/** Forget every phone and what they sent. */
export const disconnectPhones = (userId: unknown) => removeDevices(userId)

/* ---------- The Screen Time page ---------- */

export const phoneRouter = Router()

const publicDevice = (d: { id: string; name: string; lastSyncedAt?: Date | null; createdAt?: Date }) => ({
  id: d.id,
  name: d.name,
  lastSyncedAt: d.lastSyncedAt ?? null,
  pairedAt: d.createdAt ?? null,
})

const reachInfo = () => ({ addresses: lanAddresses(), listening: listensOnNetwork() })

phoneRouter.get('/', async (req, res) => {
  const devices = await PhoneDevice.find({ userId: currentUserId(req) }).sort({ createdAt: 1 })
  res.json({ devices: devices.map((d) => publicDevice({ id: d.id, name: d.name, lastSyncedAt: d.lastSyncedAt, createdAt: d.createdAt })), ...reachInfo() })
})

// A new code replaces any earlier one. It works once, for ten minutes.
phoneRouter.post('/pair-code', async (req, res) => {
  const userId = currentUserId(req)
  const code = makeCode()
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60 * 1000)
  await PhonePairing.findOneAndUpdate({ userId }, { codeHash: sha256(code), expiresAt }, { upsert: true })
  res.status(201).json({ code: showCode(code), expiresAt, ...reachInfo() })
})

phoneRouter.delete('/:id', async (req, res) => {
  await removeDevices(currentUserId(req), { _id: requireId(req.params.id) })
  res.status(204).end()
})

/* ---------- The phone app ---------- */

export const phoneAppRouter = Router()

// 8 wrong codes per address in 15 minutes, then wait. The code is also short-lived and single use.
const pairLimiter = createAttemptLimiter(8, 15 * 60 * 1000)

const pairSchema = z.strictObject({
  code: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60).default('Android phone'),
})

phoneAppRouter.post('/pair', async (req, res) => {
  const { code, name } = pairSchema.parse(req.body)
  const key = String(req.ip)
  if (pairLimiter.isBlocked(key)) throw new HttpError(429, 'Too many wrong codes. Wait a few minutes and try again.')

  const pairing = await PhonePairing.findOneAndDelete({ codeHash: sha256(normalizeCode(code)), expiresAt: { $gt: new Date() } })
  if (!pairing) {
    pairLimiter.recordFailure(key)
    throw new HttpError(400, 'That code is wrong or has run out. Make a new one on the Screen Time page.')
  }
  pairLimiter.reset(key)

  const userId = pairing.userId
  // Two phones can't share a name, because the name is what their numbers are filed under.
  const taken = new Set((await PhoneDevice.find({ userId })).map((d) => d.name))
  let unique = name
  for (let n = 2; taken.has(unique); n++) unique = `${name} ${n}`

  const token = randomBytes(32).toString('base64url')
  await PhoneDevice.create({ userId, name: unique, tokenHash: sha256(token) })
  await Connection.findOneAndUpdate({ userId, provider: PHONE_PROVIDER }, { $setOnInsert: { connectedAt: new Date() }, accountLabel: 'Valkyrie phone app' }, { upsert: true })
  res.status(201).json({ token, name: unique })
})

/** Everything below needs the key the phone got when it paired. */
const requirePhone: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const device = token ? await PhoneDevice.findOne({ tokenHash: sha256(token) }) : null
  if (!device) throw new HttpError(401, 'This phone is not paired any more. Pair it again from the Screen Time page.')
  res.locals.device = device
  next()
}

const deviceOf = (res: { locals: Record<string, unknown> }) => res.locals.device as InstanceType<typeof PhoneDevice>

phoneAppRouter.get('/status', requirePhone, (_req, res) => {
  res.json({ name: deviceOf(res).name })
})

const MAX_DAY_SECONDS = 24 * 3600
const syncSchema = z.strictObject({
  days: z
    .array(
      z.strictObject({
        day: dateString,
        apps: z.array(z.strictObject({ app: z.string().trim().min(1).max(120), seconds: z.number().min(1).max(MAX_DAY_SECONDS) })).max(500),
        // Only days the phone could count exactly have these; for older days they are left out, and what is kept stays.
        unlocks: z.number().int().min(0).max(100_000).optional(),
        notifications: z.array(z.strictObject({ app: z.string().trim().min(1).max(120), count: z.number().int().min(1).max(100_000) })).max(500).optional(),
      }),
    )
    .min(1)
    .max(31),
})

const MAX_ICONS_ASKED = 40

// The phone sends the days it has. Those days are replaced, not added to, so sending the same day twice is harmless.
phoneAppRouter.post('/sync', requirePhone, async (req, res) => {
  const device = deviceOf(res)
  const userId = device.userId
  const { days } = syncSchema.parse(req.body)

  const rows = days.flatMap(({ day, apps }) => {
    const byApp = new Map<string, number>() // two apps with one name are one line
    for (const a of apps) byApp.set(a.app, Math.min(MAX_DAY_SECONDS, (byApp.get(a.app) ?? 0) + a.seconds))
    return [...byApp].map(([app, seconds]) => ({ userId, device: device.name, source: PHONE_SOURCE, day, app, seconds: Math.round(seconds) })).filter((r) => r.seconds > 0)
  })

  await ScreenTimeUsage.deleteMany({ userId, source: PHONE_SOURCE, device: device.name, day: { $in: [...new Set(days.map((d) => d.day))] } })
  if (rows.length) await ScreenTimeUsage.insertMany(rows)

  const counted = days.filter((d) => d.unlocks !== undefined)
  if (counted.length) {
    await PhoneDay.bulkWrite(
      counted.map((d) => {
        const byApp = new Map<string, number>() // two apps with one name are one line
        for (const n of d.notifications ?? []) byApp.set(n.app, (byApp.get(n.app) ?? 0) + n.count)
        const notifications = [...byApp].map(([app, count]) => ({ app, count }))
        return {
          updateOne: {
            filter: { userId, device: device.name, day: d.day },
            update: { $set: { unlocks: d.unlocks, notifications } },
            upsert: true,
          },
        }
      }),
    )
  }

  const now = new Date()
  await Promise.all([
    PhoneDevice.updateOne({ _id: device._id }, { lastSyncedAt: now }),
    Connection.updateOne({ userId, provider: PHONE_PROVIDER }, { lastSyncedAt: now }),
  ])

  // Ask for the pictures of apps we have none for, a few at a time.
  const names = [...new Set(rows.map((r) => r.app))]
  const have = new Set((await PhoneIcon.find({ userId, app: { $in: names } }).select('app')).map((i) => i.app))
  res.json({ days: days.length, apps: rows.length, wantIcons: names.filter((n) => !have.has(n)).slice(0, MAX_ICONS_ASKED) })
})

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const MAX_ICON_BYTES = 20_000

phoneAppRouter.post('/icons', requirePhone, async (req, res) => {
  const userId = deviceOf(res).userId
  const { icons } = z.strictObject({ icons: z.record(z.string().max(120), z.string().max(MAX_ICON_BYTES * 2)) }).parse(req.body)
  const entries = Object.entries(icons).slice(0, 60)
  const known = new Set((await ScreenTimeUsage.distinct('app', { userId, source: PHONE_SOURCE, app: { $in: entries.map(([app]) => app) } })) as string[])
  let saved = 0
  for (const [app, base64] of entries) {
    const data = Buffer.from(base64, 'base64')
    if (!known.has(app) || data.length > MAX_ICON_BYTES || !data.subarray(0, 8).equals(PNG)) continue // only real PNGs, only for apps it sent
    await PhoneIcon.findOneAndUpdate({ userId, app }, { type: 'image/png', data }, { upsert: true })
    saved++
  }
  res.json({ saved })
})

// The phone's own "unpair": forget this phone and its numbers.
phoneAppRouter.delete('/me', requirePhone, async (_req, res) => {
  const device = deviceOf(res)
  await removeDevices(device.userId, { _id: device._id })
  res.status(204).end()
})
