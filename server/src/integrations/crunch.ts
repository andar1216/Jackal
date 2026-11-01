import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { currentUserId } from '../auth/middleware.js'
import { HttpError } from '../lib/errors.js'
import { decryptSecret, encryptSecret, hasEncryptionKey } from '../lib/secrets.js'
import { Connection, CrunchCheckIn, CrunchClass, CrunchImportToken, CrunchLink, CrunchPayment } from '../models.js'
import { CrunchError, crunchGateway, parseBilling, parseCheckIns, parseClasses, type CrunchSnapshot } from './crunchGateway.js'

/** Two ways in: the person lets Jackal sign in for them (below), or sends the data from their own browser (`crunchImportRouter`). */
export const crunchRouter = Router()

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
})

/** One sync at a time per person, so a double click does not hit Crunch twice. */
const running = new Set<string>()

/** A wrong password is a 422, not a 401: a 401 would sign the person out of Jackal itself. */
const toHttpError = (err: unknown) => {
  if (!(err instanceof CrunchError)) return err
  if (err.code === 'BAD_LOGIN') return new HttpError(422, err.message)
  return new HttpError(502, err.message)
}

async function replaceData(userId: unknown, snap: CrunchSnapshot) {
  // Everything is fetched before anything is replaced, so a failed sync never leaves the data half-empty.
  await Promise.all([
    CrunchCheckIn.deleteMany({ userId }),
    CrunchClass.deleteMany({ userId }),
    CrunchPayment.deleteMany({ userId }),
  ])
  const seen = new Set<string>()
  const checkIns = snap.checkIns.filter((c) => !seen.has(c.id) && seen.add(c.id))
  await Promise.all([
    CrunchCheckIn.insertMany(checkIns.map((c) => ({ userId, externalId: c.id, at: new Date(`${c.at.slice(0, 16)}:00Z`), club: c.club }))),
    CrunchClass.insertMany(snap.classes.map((c) => ({ userId, ...c }))),
    CrunchPayment.insertMany(snap.payments.map((p) => ({ userId, ...p }))),
  ])
}

const counts = (snap: CrunchSnapshot) => ({
  checkIns: snap.checkIns.length,
  classes: snap.classes.length,
  payments: snap.payments.length,
})

async function runSync<T>(userId: string, work: () => Promise<T>) {
  if (running.has(userId)) throw new HttpError(409, 'A Crunch sync is already running.')
  running.add(userId)
  try {
    return await work()
  } finally {
    running.delete(userId)
  }
}

const requireKey = () => {
  if (!hasEncryptionKey()) {
    throw new HttpError(503, 'Crunch needs INTEGRATION_ENCRYPTION_KEY in .env, so your password can be stored encrypted.')
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/* ---------- Jackal signs in for the person ---------- */

// Sign in once with the person's Crunch details, import everything, and keep the (encrypted) login for later syncs.
crunchRouter.post('/connect', async (req, res) => {
  requireKey()
  const userId = currentUserId(req)
  const { email, password } = credentialsSchema.parse(req.body)

  const snap = await runSync(String(userId), async () => {
    const fetched = await crunchGateway().fetchAll(email, password).catch((err) => {
      throw toHttpError(err)
    })
    await CrunchLink.findOneAndUpdate(
      { userId },
      {
        email,
        password: encryptSecret(password),
        autoSync: true,
        memberId: fetched.memberId,
        workoutGoal: fetched.workoutGoal,
        balanceCents: fetched.balanceCents,
        lastSyncedAt: new Date(),
        $unset: { lastError: '' },
      },
      { upsert: true },
    )
    await Connection.findOneAndUpdate({ userId, provider: 'crunch' }, { accountLabel: email, connectedAt: new Date() }, { upsert: true })
    await replaceData(userId, fetched)
    return fetched
  })
  res.status(201).json(counts(snap))
})

// Sign in again with the saved login and refresh everything.
crunchRouter.post('/sync', async (req, res) => {
  requireKey()
  const userId = currentUserId(req)
  const link = await CrunchLink.findOne({ userId }).select('+password')
  if (!link) throw new HttpError(409, 'Crunch is not connected yet.')
  if (!link.password || !link.email) {
    throw new HttpError(409, 'Crunch was connected from your browser, so Jackal has no login to refresh with. Click the "Send to Jackal" bookmark on the Crunch tab instead.')
  }
  const { email, password } = { email: link.email, password: link.password }

  const snap = await runSync(String(userId), async () => {
    let fetched: CrunchSnapshot
    try {
      fetched = await crunchGateway().fetchAll(email, decryptSecret(password))
    } catch (err) {
      const e = toHttpError(err)
      // Keep the reason so the Fitness page can say why the numbers are stale.
      const message = e instanceof HttpError ? e.message : 'Could not read the saved Crunch login.'
      await CrunchLink.updateOne({ userId }, { lastError: message })
      throw e instanceof HttpError ? e : new HttpError(500, message)
    }
    await CrunchLink.updateOne(
      { userId },
      {
        memberId: fetched.memberId,
        workoutGoal: fetched.workoutGoal,
        balanceCents: fetched.balanceCents,
        lastSyncedAt: new Date(),
        $unset: { lastError: '' },
      },
    )
    await replaceData(userId, fetched)
    return fetched
  })
  res.json(counts(snap))
})

/* ---------- The person signs in on Crunch's own site and sends the data from there ---------- */

const IMPORT_TOKEN_DAYS = 180

// Makes the secret for the "Send to Jackal" bookmark. A new one replaces the old, so old bookmarks stop working.
crunchRouter.post('/import-token', async (req, res) => {
  const userId = currentUserId(req)
  const token = randomBytes(32).toString('base64url')
  await CrunchImportToken.findOneAndUpdate(
    { userId },
    { tokenHash: sha256(token), expiresAt: new Date(Date.now() + IMPORT_TOKEN_DAYS * 24 * 3600 * 1000) },
    { upsert: true },
  )
  res.status(201).json({ token })
})

const importSchema = z.object({
  memberId: z.string().regex(/^\d{1,20}$/),
  workoutGoal: z.number().int().min(1).max(100).nullish(),
  // Crunch's own answers, passed along untouched and read by the same code the sign-in route uses.
  checkIns: z.unknown(),
  classes: z.unknown(),
  billing: z.unknown(),
})

/**
 * Called by the bookmark, from members.crunch.com, so it is mounted in app.ts ahead of the usual sign-in and
 * same-origin checks and answers only that one website. It proves who it is with the bookmark's secret.
 */
export const crunchImportRouter = Router()

crunchImportRouter.post('/', async (req, res) => {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const record = token ? await CrunchImportToken.findOne({ tokenHash: sha256(token) }) : null
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw new HttpError(401, 'This bookmark is out of date. Open Connectors in Jackal and get a new one.')
  }
  const userId = record.userId

  const body = importSchema.parse(req.body)
  let snap: CrunchSnapshot
  try {
    const billing = parseBilling(body.billing)
    snap = {
      memberId: body.memberId,
      workoutGoal: body.workoutGoal ?? undefined,
      checkIns: parseCheckIns(body.checkIns),
      classes: parseClasses(body.classes),
      payments: billing.payments,
      balanceCents: billing.balanceCents,
    }
  } catch (err) {
    if (err instanceof CrunchError) throw new HttpError(400, err.message)
    throw err
  }

  await runSync(String(userId), async () => {
    await CrunchLink.findOneAndUpdate(
      { userId },
      {
        memberId: snap.memberId,
        workoutGoal: snap.workoutGoal,
        balanceCents: snap.balanceCents,
        lastSyncedAt: new Date(),
        $unset: { lastError: '' },
        // Only for a brand new link. One made by signing in keeps its saved login and its auto-refresh.
        $setOnInsert: { autoSync: false },
      },
      { upsert: true },
    )
    await Connection.findOneAndUpdate(
      { userId, provider: 'crunch' },
      { $setOnInsert: { accountLabel: 'Signed in on members.crunch.com', connectedAt: new Date() } },
      { upsert: true },
    )
    await replaceData(userId, snap)
  })
  res.json(counts(snap))
})

/* ---------- Reading it back ---------- */

// Everything the Fitness page shows, newest first. The password never leaves the server.
crunchRouter.get('/data', async (req, res) => {
  const userId = currentUserId(req)
  const link = await CrunchLink.findOne({ userId })
  if (!link) {
    res.json({ connected: false, checkIns: [], classes: [], payments: [] })
    return
  }
  const [checkIns, classes, payments] = await Promise.all([
    CrunchCheckIn.find({ userId }).sort({ at: -1 }),
    CrunchClass.find({ userId }).sort({ startsAt: -1 }),
    CrunchPayment.find({ userId }).sort({ date: -1 }),
  ])
  res.json({
    connected: true,
    email: link.email ?? null,
    autoSync: link.autoSync ?? true,
    workoutGoal: link.workoutGoal ?? null,
    balanceCents: link.balanceCents ?? null,
    lastSyncedAt: link.lastSyncedAt ?? null,
    lastError: link.lastError ?? null,
    checkIns: checkIns.map((c) => ({ id: c.externalId, at: c.at.toISOString().slice(0, 16), club: c.club ?? '' })),
    classes: classes.map((c) => ({ id: c.id, program: c.program, startsAt: c.startsAt, club: c.club ?? '', status: c.status, feeCents: c.feeCents ?? null })),
    payments: payments.map((p) => ({ id: p.id, service: p.service, amountCents: p.amountCents, date: p.date })),
  })
})

/** Forget the login, the bookmark's secret and everything imported from Crunch. */
export async function disconnectCrunch(userId: unknown) {
  await Promise.all([
    CrunchLink.deleteOne({ userId }),
    CrunchImportToken.deleteOne({ userId }),
    CrunchCheckIn.deleteMany({ userId }),
    CrunchClass.deleteMany({ userId }),
    CrunchPayment.deleteMany({ userId }),
    Connection.deleteOne({ userId, provider: 'crunch' }),
  ])
}
