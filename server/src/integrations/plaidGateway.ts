import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from 'plaid'
import { config } from '../config.js'
import { hasEncryptionKey } from '../lib/secrets.js'

/** The few things we need from Plaid, in our own terms. Tests swap in a fake (see `setPlaidGateway`). */

export type PlaidTx = {
  id: string
  accountId: string
  /** Plaid's sign: positive means money left the account. */
  amount: number
  date: string // YYYY-MM-DD
  name: string
  merchantName?: string
  primaryCategory?: string
  detailedCategory?: string
}

export type PlaidAccount = {
  accountId: string
  name: string
  mask?: string
  type?: string
  subtype?: string
  /** Current balance in dollars. For a credit card or loan this is what is owed. Plaid may not have it yet. */
  balance?: number
}

export type SyncPage = {
  added: PlaidTx[]
  modified: PlaidTx[]
  removed: string[]
  nextCursor: string
  hasMore: boolean
  accounts: PlaidAccount[]
  /** Plaid is still doing its first pull for a freshly linked bank. */
  notReady?: boolean
}

export class PlaidError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export type PlaidGateway = {
  isConfigured(): boolean
  createLinkToken(userId: string): Promise<string>
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>
  getInstitutionName(accessToken: string): Promise<string | undefined>
  /** Every account the person shared. A transactions sync only mentions some of them. */
  getAccounts(accessToken: string): Promise<PlaidAccount[]>
  syncTransactions(accessToken: string, cursor?: string): Promise<SyncPage>
  removeItem(accessToken: string): Promise<void>
}

/** Plaid's SDK throws axios errors. Pull out Plaid's own code and message. */
function toPlaidError(err: unknown): PlaidError {
  const data = (err as { response?: { data?: { error_code?: string; error_message?: string; display_message?: string } } })
    .response?.data
  if (data?.error_code) {
    // Plaid error messages contain no secrets, so they are safe to show.
    return new PlaidError(data.error_code, data.display_message || data.error_message || data.error_code)
  }
  return new PlaidError('UNREACHABLE', "Couldn't reach Plaid.")
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toPlaidError(err)
  }
}

let client: PlaidApi | undefined
const api = () => {
  client ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.plaid.env] ?? PlaidEnvironments.sandbox,
      baseOptions: {
        headers: { 'PLAID-CLIENT-ID': config.plaid.clientId, 'PLAID-SECRET': config.plaid.secret },
      },
    }),
  )
  return client
}

const realGateway: PlaidGateway = {
  isConfigured: () => Boolean(config.plaid.clientId && config.plaid.secret) && hasEncryptionKey(),

  async createLinkToken(userId) {
    const res = await call(() =>
      api().linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'Jackal',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
        transactions: { days_requested: 365 },
        ...(config.plaid.redirectUri ? { redirect_uri: config.plaid.redirectUri } : {}),
      }),
    )
    return res.data.link_token
  },

  async exchangePublicToken(publicToken) {
    const res = await call(() => api().itemPublicTokenExchange({ public_token: publicToken }))
    return { accessToken: res.data.access_token, itemId: res.data.item_id }
  },

  async getInstitutionName(accessToken) {
    try {
      const item = await api().itemGet({ access_token: accessToken })
      const id = item.data.item.institution_id
      if (!id) return undefined
      const inst = await api().institutionsGetById({ institution_id: id, country_codes: [CountryCode.Us] })
      return inst.data.institution.name
    } catch {
      return undefined // the name is only a label, so a failure here isn't worth failing the link
    }
  },

  async getAccounts(accessToken) {
    const res = await call(() => api().accountsGet({ access_token: accessToken }))
    return res.data.accounts.map((a) => ({
      accountId: a.account_id,
      name: a.name,
      mask: a.mask ?? undefined,
      type: a.type,
      subtype: a.subtype ?? undefined,
      balance: a.balances.current ?? undefined,
    }))
  },

  async syncTransactions(accessToken, cursor) {
    try {
      const res = await api().transactionsSync({
        access_token: accessToken,
        cursor: cursor || undefined,
        count: 200,
        options: { include_personal_finance_category: true },
      })
      const map = (t: (typeof res.data.added)[number]): PlaidTx => ({
        id: t.transaction_id,
        accountId: t.account_id,
        amount: t.amount,
        date: t.date,
        name: t.name,
        merchantName: t.merchant_name ?? undefined,
        primaryCategory: t.personal_finance_category?.primary,
        detailedCategory: t.personal_finance_category?.detailed,
      })
      return {
        added: res.data.added.map(map),
        modified: res.data.modified.map(map),
        removed: res.data.removed.map((r) => r.transaction_id).filter((id): id is string => Boolean(id)),
        nextCursor: res.data.next_cursor,
        hasMore: res.data.has_more,
        accounts: res.data.accounts.map((a) => ({
          accountId: a.account_id,
          name: a.name,
          mask: a.mask ?? undefined,
          type: a.type,
          subtype: a.subtype ?? undefined,
        })),
      }
    } catch (err) {
      const e = toPlaidError(err)
      if (e.code === 'PRODUCT_NOT_READY') {
        return { added: [], modified: [], removed: [], nextCursor: cursor ?? '', hasMore: false, accounts: [], notReady: true }
      }
      throw e
    }
  },

  async removeItem(accessToken) {
    await call(() => api().itemRemove({ access_token: accessToken }))
  },
}

let gateway: PlaidGateway = realGateway
export const plaidGateway = () => gateway
export const setPlaidGateway = (next: PlaidGateway | undefined) => {
  gateway = next ?? realGateway
}
