import type { AccountView, BankAccount, Integration, ManualAccount, Skill, Transaction, User } from '../types'

// Dev: Vite proxies /api to the backend. For a separate API host, set VITE_API_URL.
const BASE = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Called when the server says the session is gone (expired, signed out elsewhere), so the app can show sign-in.
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include', // send the session cookie, also when the API is on another host
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?")
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Not JSON (for example an HTML error page from a proxy).
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : res.status >= 500
          ? "Can't reach the server. Is the backend running?"
          : `Request failed (${res.status})`
    // A 401 on the auth routes just means "wrong password" or "not signed in yet", which the forms show themselves.
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized()
    throw new ApiError(res.status, message)
  }
  return data as T
}

export const authApi = {
  me: () => request<User>('GET', '/auth/me'),
  register: (input: { email: string; name: string; password: string }) => request<User>('POST', '/auth/register', input),
  login: (input: { email: string; password: string }) => request<User>('POST', '/auth/login', input),
  logout: () => request<void>('POST', '/auth/logout'),
  updateName: (name: string) => request<User>('PATCH', '/auth/me', { name }),
}

export type NewSkill = Pick<Skill, 'name' | 'color' | 'startDate'>

export const skillsApi = {
  list: () => request<Skill[]>('GET', '/skills'),
  create: (skill: NewSkill) => request<Skill>('POST', '/skills', skill),
  update: (id: string, changes: Partial<Pick<Skill, 'name' | 'color' | 'avgWeeks'>>) =>
    request<Skill>('PATCH', `/skills/${id}`, changes),
  remove: (id: string) => request<void>('DELETE', `/skills/${id}`),
  toggleDay: (id: string, dateKey: string) => request<Skill>('POST', `/skills/${id}/logs/${dateKey}/toggle`),
}

export const integrationsApi = {
  list: () => request<Integration[]>('GET', '/integrations'),
  connect: (id: string) => request<void>('POST', `/integrations/${id}/connect`),
  disconnect: async (id: string) => {
    await request<void>('DELETE', `/integrations/${id}/connection`)
    if (id === 'plaid') notifyTransactionsChanged()
  },
}

/** Pages showing transactions listen for this, so they refresh after a bank import. */
export const TRANSACTIONS_CHANGED = 'jackal:transactions-changed'
const notifyTransactionsChanged = () => window.dispatchEvent(new Event(TRANSACTIONS_CHANGED))

export type NewTransaction = Pick<Transaction, 'type' | 'amountCents' | 'category' | 'date' | 'note'>

export const transactionsApi = {
  // Both dates are YYYY-MM-DD, inclusive.
  list: (from: string, to: string) => request<Transaction[]>('GET', `/transactions?from=${from}&to=${to}`),
  create: (t: NewTransaction) => request<Transaction>('POST', '/transactions', t),
  remove: (id: string) => request<void>('DELETE', `/transactions/${id}`),
}

export const viewsApi = {
  list: () => request<AccountView[]>('GET', '/views'),
  create: (v: Pick<AccountView, 'name' | 'accounts'>) => request<AccountView>('POST', '/views', v),
  update: (id: string, v: Partial<Pick<AccountView, 'name' | 'accounts'>>) => request<AccountView>('PATCH', `/views/${id}`, v),
  remove: (id: string) => request<void>('DELETE', `/views/${id}`),
}

export const accountsApi = {
  list: () => request<ManualAccount[]>('GET', '/accounts'),
  create: (a: Pick<ManualAccount, 'name' | 'kind' | 'mask' | 'balanceCents'>) => request<ManualAccount>('POST', '/accounts', a),
  update: (id: string, patch: Partial<Pick<ManualAccount, 'name' | 'balanceCents'>>) =>
    request<ManualAccount>('PATCH', `/accounts/${id}`, patch),
}

export type PlaidSyncResult = {
  added: number
  modified: number
  removed: number
  notReady: boolean
  /** Banks that couldn't be synced this time. The others still were. */
  errors?: { institution: string; message: string }[]
}

export const plaidApi = {
  linkToken: () => request<{ linkToken: string }>('POST', '/integrations/plaid/link-token'),
  exchange: async (publicToken: string, institutionName?: string) => {
    const res = await request<{ institution: string; sync: PlaidSyncResult | { error: string } }>(
      'POST',
      '/integrations/plaid/exchange',
      { publicToken, institutionName },
    )
    notifyTransactionsChanged()
    return res
  },
  accounts: () => request<BankAccount[]>('GET', '/integrations/plaid/accounts'),
  sync: async () => {
    const res = await request<PlaidSyncResult>('POST', '/integrations/plaid/sync')
    notifyTransactionsChanged()
    return res
  },
}
