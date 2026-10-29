import { Router } from 'express'
import { z } from 'zod'
import { currentUserId } from '../auth/middleware.js'
import { HttpError } from '../lib/errors.js'
import { balanceCents } from '../lib/balances.js'
import { decryptSecret, encryptSecret } from '../lib/secrets.js'
import { PlaidItem, Transaction } from '../models.js'
import { PlaidError, plaidGateway, type PlaidTx } from './plaidGateway.js'

const MAX_BANKS_PER_USER = 5

/** Bump when the way we import changes. Banks imported with an older version are fetched again once. */
const SYNC_VERSION = 2

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

type AccountInfo = { name?: string | null; mask?: string | null; type?: string | null; balanceCents?: number | null }

/** How an account is shown, for example "Chase · Checking ••1234". Also what transactions are grouped by. */
export const accountLabel = (institution: string, a: AccountInfo) =>
  `${institution} · ${a.name ?? 'Account'}${a.mask ? ` ••${a.mask}` : ''}`

export type KnownAccount = { label: string; isCredit: boolean }

export function toTransactionFields(t: PlaidTx, accounts: Map<string, KnownAccount>) {
  const cents = Math.round(Math.abs(t.amount) * 100)
  if (cents === 0 || isInternalMove(t)) return null

  const account = accounts.get(t.accountId)
  const moneyIn = t.amount < 0 // Plaid: positive = money out
  const category = CATEGORY_MAP[t.primaryCategory ?? ''] ?? 'Other'
  const common = {
    amountCents: cents,
    date: t.date,
    note: (t.merchantName || t.name).slice(0, 500),
    accountName: account?.label,
    accountId: t.accountId,
  }

  // A credit card is only for spending. Money coming back onto it is a refund, which lowers
  // what you spent. It is never income.
  if (account?.isCredit) {
    // A payment toward the card that Plaid didn't label as one would count twice, so leave it out.
    if (moneyIn && /payment|autopay/i.test(t.name)) return null
    return { ...common, type: 'expense' as const, category, isRefund: moneyIn }
  }

  return moneyIn
    ? { ...common, type: 'income' as const, category: 'Other', isRefund: false }
    : { ...common, type: 'expense' as const, category, isRefund: false }
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
  syncVersion?: number | null
  accounts: {
    accountId?: string | null
    name?: string | null
    mask?: string | null
    type?: string | null
    subtype?: string | null
    balanceCents?: number | null
  }[]
  save(): Promise<unknown>
}

const isStale = (item: ItemDoc) => (item.syncVersion ?? 0) < SYNC_VERSION

/** Pull everything new for one bank and store it. Safe to run any time, as repeats never duplicate. */
export async function syncItem(item: ItemDoc, options: { fromScratch?: boolean } = {}): Promise<SyncResult> {
  const gateway = plaidGateway()
  const accessToken = decryptSecret(item.accessToken)
  const result: SyncResult = { added: 0, modified: 0, removed: 0, notReady: false }

  // Starting from nothing fetches the whole history again. That is safe, since saving is by bank id.
  const fromScratch = options.fromScratch || isStale(item)
  const startCursor = fromScratch ? undefined : (item.cursor ?? undefined)
  let cursor = startCursor
  let restarts = 0

  // A transactions sync only mentions accounts that have changes, so ask for the full list separately.
  // This is how an account with no recent activity still gets listed.
  const accountList = await gateway.getAccounts(accessToken).catch(() => [])
  // Balances come along with the list, so Net worth stays as fresh as the last sync.
  if (accountList.length > 0) {
    item.accounts = accountList.map((a) => ({
      accountId: a.accountId,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balanceCents: balanceCents({ type: a.type, current: a.balance, available: a.available, limit: a.limit }),
    }))
  }

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

    if (item.accounts.length === 0 && page.accounts.length > 0) item.accounts = page.accounts
    const known = new Map<string, KnownAccount>(
      item.accounts.map((a) => [a.accountId ?? '', { label: accountLabel(item.institutionName, a), isCredit: a.type === 'credit' }]),
    )

    const writes = []
    const dropIds = [...page.removed]
    for (const t of [...page.added, ...page.modified]) {
      const fields = toTransactionFields(t, known)
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

  if (!result.notReady) item.syncVersion = SYNC_VERSION
  item.lastSyncedAt = new Date()
  await item.save()
  return result
}

/* ---------- HTTP routes ---------- */

const exchangeSchema = z.strictObject({
  publicToken: z.string().min(1).max(500),
  institutionName: z.string().trim().max(120).optional(),
})

/** Plaid's problems as clear API errors instead of a generic 500. */
function toHttpError(err: unknown) {
  if (!(err instanceof PlaidError)) return err
  console.error(`Plaid error ${err.code}`)
  if (err.code === 'ITEM_LOGIN_REQUIRED') {
    return new HttpError(409, 'Your bank needs you to sign in again. Disconnect Plaid and connect it again.')
  }
  return new HttpError(502, `Plaid: ${err.message}`)
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toHttpError(err)
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

// One bank failing must not stop the others from syncing, so problems are listed per bank.
plaidRouter.post('/sync', async (req, res) => {
  requireConfigured()
  const items = await PlaidItem.find({ userId: currentUserId(req) }).select('+accessToken')
  if (items.length === 0) throw new HttpError(409, 'No bank is connected yet.')

  const total: SyncResult & { errors: { institution: string; message: string }[] } = {
    added: 0,
    modified: 0,
    removed: 0,
    notReady: false,
    errors: [],
  }
  for (const item of items) {
    try {
      const r = await syncItem(item as unknown as ItemDoc)
      total.added += r.added
      total.modified += r.modified
      total.removed += r.removed
      total.notReady ||= r.notReady
    } catch (err) {
      const e = toHttpError(err)
      if (!(e instanceof HttpError)) throw e
      total.errors.push({ institution: item.institutionName, message: e.message })
    }
  }
  res.json(total)
})

// Every account Jackal knows about, so the Finances screen can list them even with no activity this month.
plaidRouter.get('/accounts', async (req, res) => {
  const items = await PlaidItem.find({ userId: currentUserId(req) }).sort({ createdAt: 1 })
  res.json(
    items.flatMap((item) =>
      item.accounts.map((a: AccountInfo) => ({
        label: accountLabel(item.institutionName, a),
        institution: item.institutionName,
        type: a.type ?? undefined,
        balanceCents: a.balanceCents ?? undefined,
      })),
    ),
  )
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
