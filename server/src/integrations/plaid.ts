import { Router } from 'express'
import { z } from 'zod'
import { currentUserId } from '../auth/middleware.js'
import { HttpError } from '../lib/errors.js'
import { decryptSecret, encryptSecret } from '../lib/secrets.js'
import { PlaidItem, Transaction } from '../models.js'
import { PlaidError, plaidGateway, type PlaidTx } from './plaidGateway.js'

const MAX_BANKS_PER_USER = 5

/* ---------- Turning Plaid transactions into Jackal transactions ---------- */

// Jackal's Finances screen budgets by these categories. Anything else becomes "Other".
const CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK: 'Food',
  RENT_AND_UTILITIES: 'Rent',
  TRANSPORTATION: 'Transport',
  TRAVEL: 'Transport',
  ENTERTAINMENT: 'Fun',
}

/**
 * Money moving between your own accounts (and credit card payments) would count twice,
 * once leaving one account and once arriving in another, so it is left out.
 */
const isInternalMove = (t: PlaidTx) =>
  t.primaryCategory === 'TRANSFER_IN' ||
  t.primaryCategory === 'TRANSFER_OUT' ||
  t.detailedCategory === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

export function toTransactionFields(t: PlaidTx, accountNames: Map<string, string>) {
  const cents = Math.round(Math.abs(t.amount) * 100)
  if (cents === 0 || isInternalMove(t)) return null
  const isIncome = t.amount < 0 // Plaid: positive = money out
  return {
    type: isIncome ? ('income' as const) : ('expense' as const),
    amountCents: cents,
    category: isIncome ? 'Other' : (CATEGORY_MAP[t.primaryCategory ?? ''] ?? 'Other'),
    date: t.date,
    note: (t.merchantName || t.name).slice(0, 500),
    accountName: accountNames.get(t.accountId),
    accountId: t.accountId,
  }
}

/* ---------- Syncing ---------- */

export type SyncResult = { added: number; modified: number; removed: number; notReady: boolean }

/** The parts of a stored bank (PlaidItem) that syncing uses. */
type ItemDoc = {
  userId: unknown
  institutionName: string
  accessToken: string // encrypted
  cursor?: string | null
  lastSyncedAt?: Date | null
  accounts: { accountId?: string | null; name?: string | null; mask?: string | null }[]
  save(): Promise<unknown>
}
/** Pull everything new for one bank and store it. Safe to run any time, as repeats never duplicate. */
export async function syncItem(item: ItemDoc, options: { fromScratch?: boolean } = {}): Promise<SyncResult> {
  const gateway = plaidGateway()
  const accessToken = decryptSecret(item.accessToken)
  const result: SyncResult = { added: 0, modified: 0, removed: 0, notReady: false }

  // Starting from nothing fetches the whole history again. That is safe, since saving is by bank id.
  const startCursor = options.fromScratch ? undefined : (item.cursor ?? undefined)
  let cursor = startCursor
  let restarts = 0

  for (;;) {
    let page
    try {
      page = await gateway.syncTransactions(accessToken, cursor)
    } catch (err) {
      // Plaid asks us to start over if the data changed between pages.
      if (err instanceof PlaidError && err.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restarts < 3) {
        restarts++
        cursor = startCursor
        Object.assign(result, { added: 0, modified: 0, removed: 0 })
        continue
      }
      throw err
    }

    if (page.notReady) {
      result.notReady = true
      break
    }

    if (page.accounts.length > 0) item.accounts = page.accounts
    // Shown on the Finances screen, for example "Chase · Checking ••1234".
    const names = new Map(
      item.accounts.map((a) => [a.accountId ?? '', ` · ${a.name ?? 'Account'}${a.mask ?  ••${a.mask}` : ''}`]),
    )

    const writes = []
    const dropIds = [...page.removed]
    for (const t of [...page.added, ...page.modified]) {
      const fields = toTransactionFields(t, names)
      if (!fields) {
        dropIds.push(t.id) // became a transfer, or was one all along
        continue
      }
      writes.push({
        updateOne: {
          filter: { userId: item.userId, source: 'plaid', externalId: t.id },
          update: { $set: { ...fields, userId: item.userId, source: 'plaid', externalId: t.id } },
          upsert: true,
        },
      })
    }
    if (dropIds.length > 0) {
      writes.push({ deleteMany: { filter: { userId: item.userId, source: 'plaid', externalId: { $in: dropIds } } } })
    }
    if (writes.length > 0) await Transaction.bulkWrite(writes as never)

    result.added += page.added.length
    result.modified += page.modified.length
    result.removed += page.removed.length

    cursor = page.nextCursor
    // Saved after every page: a failure part-way resumes from here, and repeating a page is harmless.
    item.cursor = cursor
    await item.save()
    if (!page.hasMore) break
  }

  item.lastSyncedAt = new Date()
  await item.save()
  return result
}

/* ---------- HTTP routes ---------- */

const exchangeSchema = z.strictObject({
  publicToken: z.string().min(1).max(500),
  institutionName: z.string().trim().max(120).optional(),
})

/** Show Plaid's problems as clear API errors instead of a generic 500. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PlaidError) {
      console.error(`Plaid error ${err.code}`)
      if (err.code === 'ITEM_LOGIN_REQUIRED') {
        throw new HttpError(409, 'Your bank needs you to sign in again. Remove it and connect it again.')
      }
      throw new HttpError(502, `Plaid: ${err.message}`)
    }
    throw err
  }
}

const requireConfigured = () => {
  if (!plaidGateway().isConfigured()) {
    throw new HttpError(503, 'Plaid is not set up on the server (check PLAID_CLIENT_ID, the secret and INTEGRATION_ENCRYPTION_KEY in .env).')
  }
}

export const plaidRouter = Router()

// Step 1: the browser asks for a short-lived token that opens Plaid Link for this user.
plaidRouter.post('/link-token', async (req, res) => {
  requireConfigured()
  const userId = currentUserId(req)
  if ((await PlaidItem.countDocuments({ userId })) >= MAX_BANKS_PER_USER) {
    throw new HttpError(400, `You can connect up to ${MAX_BANKS_PER_USER} banks.`)
  }
  res.json({ linkToken: await guard(() => plaidGateway().createLinkToken(String(userId))) })
})

// Step 2: Link finished in the browser and hands back a one-time public token. Trade it for the
// long-lived access token, which only ever lives on the server (encrypted).
plaidRouter.post('/exchange', async (req, res) => {
  requireConfigured()
  const userId = currentUserId(req)
  const { publicToken, institutionName } = exchangeSchema.parse(req.body)
  const gateway = plaidGateway()

  const { accessToken, itemId } = await guard(() => gateway.exchangePublicToken(publicToken))

  let item
  try {
    const name = (await gateway.getInstitutionName(accessToken)) || institutionName || 'Bank'
    item = await PlaidItem.create({ userId, itemId, institutionName: name, accessToken: encryptSecret(accessToken) })
  } catch (err) {
    // Don't leave a linked bank at Plaid that we have no record of.
    await gateway.removeItem(accessToken).catch(() => {})
    throw err
  }

  // The first sync can come back "not ready" for a moment. "Sync now" will pick it up.
  const synced = await guard(() => syncItem(item as unknown as ItemDoc)).catch((err: unknown) => {
    if (err instanceof HttpError) return { error: err.message }
    throw err
  })
  res.status(201).json({ institution: item.institutionName, sync: synced })
})

plaidRouter.post('/sync', async (req, res) => {
  requireConfigured()
  const items = await PlaidItem.find({ userId: currentUserId(req) }).select('+accessToken')
  if (items.length === 0) throw new HttpError(409, 'No bank is connected yet.')

  // Imports made before accounts were tracked per transaction get fetched again once, to fill that in.
  const fromScratch = Boolean(
    await Transaction.exists({ userId: currentUserId(req), source: 'plaid', accountId: { $exists: false } }),
  )

  const total: SyncResult = { added: 0, modified: 0, removed: 0, notReady: false }
  for (const item of items) {
    const r = await guard(() => syncItem(item as unknown as ItemDoc, { fromScratch }))
    total.added += r.added
    total.modified += r.modified
    total.removed += r.removed
    total.notReady ||= r.notReady
  }
  res.json(total)
})

/** Disconnect every bank: revoke access at Plaid, then remove our records and what was imported. */
export async function disconnectPlaid(userId: unknown) {
  const items = await PlaidItem.find({ userId }).select('+accessToken')
  for (const item of items) {
    try {
      await plaidGateway().removeItem(decryptSecret(item.accessToken))
    } catch {
      // Already gone at Plaid, or Plaid is unreachable. Either way our copy of the token is deleted below.
    }
  }
  await PlaidItem.deleteMany({ userId })
  // Reconnecting gives new transaction ids, so keeping these would show everything twice.
  await Transaction.deleteMany({ userId, source: 'plaid' })
}

export async function plaidStatus(userId: unknown) {
  const items = await PlaidItem.find({ userId }).sort({ createdAt: 1 })
  if (items.length === 0) return null
  return {
    connectedAt: items[0].createdAt,
    accountLabel: items.map((i) => i.institutionName).join(', '),
  }
}
