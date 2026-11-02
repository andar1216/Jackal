import type { AccountView, Goal, GoalPriority, GoalStatus, ActivityWatchStatus, BankAccount, CrunchData, DeviceGroup, Integration, ManualAccount, Meal, PanelState, PhonePairCode, PhoneStatus, ScreenTimeData, ScreenTimeSlots, Skill, SubscriptionData, Transaction, User, Workout } from '../types'
import { todayKey } from './dates'

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

export type NewSkill = Pick<Skill, 'name' | 'color' | 'startDate' | 'endDate' | 'kind'> & { autoMark?: boolean }

export const skillsApi = {
  // The server needs the person's today to fill in habits that mark themselves.
  list: () => request<Skill[]>('GET', `/skills?today=${todayKey()}`),
  create: (skill: NewSkill) => request<Skill>('POST', `/skills?today=${todayKey()}`, skill),
  update: (id: string, changes: Partial<Pick<Skill, 'name' | 'color' | 'startDate' | 'endDate' | 'avgWeeks' | 'archived' | 'autoMark' | 'streakVisible' | 'kind'>>) =>
    request<Skill>('PATCH', `/skills/${id}?today=${todayKey()}`, changes),
  remove: (id: string) => request<void>('DELETE', `/skills/${id}`),
  toggleDay: (id: string, dateKey: string) => request<Skill>('POST', `/skills/${id}/logs/${dateKey}/toggle`),
}

export const integrationsApi = {
  list: () => request<Integration[]>('GET', '/integrations'),
  connect: (id: string) => request<void>('POST', `/integrations/${id}/connect`),
  disconnect: async (id: string) => {
    await request<void>('DELETE', `/integrations/${id}/connection`)
    if (id === 'plaid') notifyTransactionsChanged()
    if (id === 'crunch') notifyCrunchChanged()
    if (id === 'activitywatch' || id === 'samsung-screen-time') window.dispatchEvent(new Event(SCREEN_TIME_CHANGED))
  },
}

/** Pages showing transactions listen for this, so they refresh after a bank import. */
export const TRANSACTIONS_CHANGED = 'valkyrie:transactions-changed'
const notifyTransactionsChanged = () => window.dispatchEvent(new Event(TRANSACTIONS_CHANGED))

export type NewTransaction = Pick<Transaction, 'type' | 'amountCents' | 'category' | 'date' | 'note'>

export const transactionsApi = {
  // Both dates are YYYY-MM-DD, inclusive.
  list: (from: string, to: string) => request<Transaction[]>('GET', `/transactions?from=${from}&to=${to}`),
  create: (t: NewTransaction) => request<Transaction>('POST', '/transactions', t),
  /** Archiving hides a transaction and leaves it out of the totals. It is never deleted, and can be restored. */
  setArchived: (id: string, archived: boolean) => request<Transaction>('PATCH', `/transactions/${id}`, { archived }),
}

export type NewMeal = Pick<Meal, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'date'>
export type NewWorkout = Pick<Workout, 'type' | 'durationMin' | 'caloriesBurned' | 'date'>

/** Meals and workouts are kept per day, so the Diet and Fitness calendars can show every day. */
export const mealsApi = {
  list: () => request<Meal[]>('GET', '/meals'),
  create: (m: NewMeal) => request<Meal>('POST', '/meals', m),
  remove: (id: string) => request<void>('DELETE', `/meals/${id}`),
}

export const workoutsApi = {
  list: () => request<Workout[]>('GET', '/workouts'),
  create: (w: NewWorkout) => request<Workout>('POST', '/workouts', w),
  remove: (id: string) => request<void>('DELETE', `/workouts/${id}`),
  /** The text of a file from Strong's Settings > Export Strong Data. */
  importStrong: (csv: string) => request<{ added: number; updated: number; skipped: number }>('POST', '/workouts/import/strong', { csv }),
}

export const subscriptionsApi = {
  list: () => request<SubscriptionData>('GET', '/subscriptions'),
  /** 'subscription' = it is one, 'not' = hide it, 'clear' = take back what you said. */
  mark: (account: string, name: string, status: 'subscription' | 'not' | 'clear') =>
    request<void>('PUT', '/subscriptions/marks', { account, name, status }),
}

export const viewsApi = {
  list: () => request<AccountView[]>('GET', '/views'),
  create: (v: Pick<AccountView, 'name' | 'accounts'>) => request<AccountView>('POST', '/views', v),
  update: (id: string, v: Partial<Pick<AccountView, 'name' | 'accounts'>>) => request<AccountView>('PATCH', `/views/${id}`, v),
  remove: (id: string) => request<void>('DELETE', `/views/${id}`),
}

/** The groups of devices on the Screen Time page. */
export const deviceGroupsApi = {
  list: () => request<DeviceGroup[]>('GET', '/device-groups'),
  create: (g: Pick<DeviceGroup, 'name' | 'devices'>) => request<DeviceGroup>('POST', '/device-groups', g),
  update: (id: string, g: Partial<Pick<DeviceGroup, 'name' | 'devices'>>) => request<DeviceGroup>('PATCH', `/device-groups/${id}`, g),
  remove: (id: string) => request<void>('DELETE', `/device-groups/${id}`),
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

/** Fitness listens for this, so it reloads after Crunch is connected or disconnected from the Connectors dialog. */
export const CRUNCH_CHANGED = 'valkyrie:crunch-changed'
const notifyCrunchChanged = () => window.dispatchEvent(new Event(CRUNCH_CHANGED))

export const crunchApi = {
  data: () => request<CrunchData>('GET', '/integrations/crunch/data'),
  /** The secret inside the "Send to Valkyrie" bookmark. Getting a new one makes the old bookmark stop working. */
  importToken: () => request<{ token: string }>('POST', '/integrations/crunch/import-token'),
  /** Tells the Fitness page to reload, for data that arrived by another route (the bookmark). */
  changed: () => notifyCrunchChanged(),
  connect: async (email: string, password: string) => {
    const res = await request<{ checkIns: number; classes: number; payments: number }>('POST', '/integrations/crunch/connect', { email, password })
    notifyCrunchChanged()
    return res
  },
  sync: async () => {
    const res = await request<{ checkIns: number; classes: number; payments: number }>('POST', '/integrations/crunch/sync')
    notifyCrunchChanged()
    return res
  },
}

export const SCREEN_TIME_CHANGED = 'valkyrie:screen-time-changed'

export const screenTimeApi = {
  data: () => request<ScreenTimeData>('GET', '/integrations/screen-time/data'),
  /** When each app and website was on screen on one day, by quarter hour. */
  slots: (day: string) => request<ScreenTimeSlots[]>('GET', `/integrations/screen-time/slots?day=${day}`),
  /** Files an app or website under a category. null puts it back to automatic. */
  setCategory: (kind: 'app' | 'site', name: string, category: string | null) =>
    request<void>('PUT', '/integrations/screen-time/category', { kind, name, category }),
  /** Where the picture for a website or app comes from (an <img> can't send headers, so this is a plain address). */
  iconUrl: (kind: 'site' | 'app', name: string, source?: 'phone') =>
    `${BASE}/integrations/screen-time/icon?kind=${kind}&name=${encodeURIComponent(name)}${source ? `&source=${source}` : ''}`,
}

const notifyScreenTimeChanged = () => window.dispatchEvent(new Event(SCREEN_TIME_CHANGED))

/** Phones running the Valkyrie app: pairing and removing. The numbers themselves come in through `screenTimeApi.data`. */
export const phoneApi = {
  status: () => request<PhoneStatus>('GET', '/integrations/phone'),
  pairCode: () => request<PhonePairCode>('POST', '/integrations/phone/pair-code'),
  remove: async (id: string) => {
    await request<void>('DELETE', `/integrations/phone/${id}`)
    notifyScreenTimeChanged()
  },
}

type AwResult = { days: number; apps: number; sites: number; status: ActivityWatchStatus }

/** ActivityWatch, read through Valkyrie's server (which runs on the same computer). */
export const activityWatchApi = {
  status: () => request<ActivityWatchStatus>('GET', '/integrations/activitywatch'),
  start: () => request<ActivityWatchStatus>('POST', '/integrations/activitywatch/start'),
  connect: async () => {
    const r = await request<AwResult>('POST', '/integrations/activitywatch/connect')
    notifyScreenTimeChanged()
    return r
  },
  sync: async () => {
    const r = await request<AwResult>('POST', '/integrations/activitywatch/sync')
    notifyScreenTimeChanged()
    return r
  },
}

export const layoutsApi = {
  list: () => request<Record<string, PanelState[]>>('GET', '/layouts'),
  save: (page: string, items: PanelState[]) => request<PanelState[]>('PUT', `/layouts/${page}`, { items }),
  reset: (page: string) => request<void>('DELETE', `/layouts/${page}`),
}

/** What the person can say about a goal. A null takes a deadline, cost or time away. */
export type GoalInput = {
  title: string
  notes: string | null
  category: string
  priority: GoalPriority
  color: string
  startDate: string
  dueDate: string | null
  budgetCents: number | null
  budgetMinutes: number | null
  status?: GoalStatus
}

export type GoalTaskInput = {
  title: string
  notes?: string | null
  dueDate?: string | null
  costCents?: number | null
  minutes?: number | null
  done?: boolean
}

// Every answer is the whole goal, steps included, so the page just swaps it in.
export const goalsApi = {
  list: () => request<Goal[]>('GET', '/goals'),
  create: (goal: GoalInput) => request<Goal>('POST', '/goals', goal),
  update: (id: string, changes: Partial<GoalInput>) => request<Goal>('PATCH', `/goals/${id}`, changes),
  remove: (id: string) => request<void>('DELETE', `/goals/${id}`),
  addTask: (id: string, task: GoalTaskInput) => request<Goal>('POST', `/goals/${id}/tasks`, task),
  updateTask: (id: string, taskId: string, changes: Partial<GoalTaskInput>) => request<Goal>('PATCH', `/goals/${id}/tasks/${taskId}`, changes),
  removeTask: (id: string, taskId: string) => request<Goal>('DELETE', `/goals/${id}/tasks/${taskId}`),
}
