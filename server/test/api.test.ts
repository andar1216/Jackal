import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import { config } from '../src/config.js'
import { connectDb, disconnectDb } from '../src/db.js'
import { CrunchError, setCrunchGateway, type CrunchGateway, type CrunchSnapshot } from '../src/integrations/crunchGateway.js'
import { PlaidError, setPlaidGateway, type PlaidGateway, type PlaidTx, type SyncPage } from '../src/integrations/plaidGateway.js'

let mongod: MongoMemoryServer
let server: Server
let base = ''

before(async () => {
  mongod = await MongoMemoryServer.create()
  await connectDb(mongod.getUri('valkyrie-test'))
  server = createApp().listen(0)
  const address = server.address()
  assert(address && typeof address === 'object')
  base = `http://127.0.0.1:${address.port}/api`
})

after(async () => {
  server.close()
  await disconnectDb()
  await mongod.stop()
})

/** A tiny browser stand-in: remembers the session cookie between requests. */
const makeClient = () => {
  let cookie = ''
  return async (method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extraHeaders }
    if (body) headers['content-type'] = 'application/json'
    if (cookie) headers.cookie = cookie
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.getSetCookie().find((c) => c.startsWith('valkyrie_sid='))
    if (set) cookie = set.startsWith('valkyrie_sid=;') ? '' : set.split(';')[0]
    const bytes = Buffer.from(await res.arrayBuffer())
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    return { status: res.status, body: isJson && bytes.length ? JSON.parse(bytes.toString('utf8')) : null, setCookie: set, headers: res.headers, bytes }
  }
}

const PASSWORD = 'correct horse battery'
let call = makeClient() // signed in as the first account once `before` has run

/** Stands in for Plaid so tests never touch the network. */
const plaid = {
  configured: false,
  pages: [] as SyncPage[],
  cursorsSeen: [] as (string | undefined)[],
  removedTokens: [] as string[],
  failExchange: false,
  failTokens: [] as string[],
  accounts: [
    { accountId: 'acc1', name: 'Checking', mask: '0000', type: 'depository', balance: 1200.5 },
    { accountId: 'acc2', name: 'Business Card', mask: '1111', type: 'credit', balance: 300.25 },
    { accountId: 'acc3', name: 'Business Checking', mask: '3333', type: 'depository' },
  ] as { accountId: string; name: string; mask?: string; type?: string; balance?: number }[],
}
const fakePlaid: PlaidGateway = {
  isConfigured: () => plaid.configured,
  createLinkToken: async (userId) => `link-sandbox-${userId}`,
  exchangePublicToken: async (publicToken) => {
    if (plaid.failExchange) throw new PlaidError('INVALID_PUBLIC_TOKEN', 'Bad token')
    return { accessToken: `access-sandbox-${publicToken}`, itemId: `item-${publicToken}` }
  },
  getInstitutionName: async () => 'Test Bank',
  // A transactions page only mentions some accounts, but this lists them all.
  getAccounts: async () => plaid.accounts,
  syncTransactions: async (token, cursor) => {
    if (plaid.failTokens.includes(token)) throw new PlaidError('INTERNAL_SERVER_ERROR', 'Bank is down')
    plaid.cursorsSeen.push(cursor)
    return plaid.pages.shift() ?? { added: [], modified: [], removed: [], nextCursor: cursor ?? 'c0', hasMore: false, accounts: [] }
  },
  removeItem: async (token) => {
    plaid.removedTokens.push(token)
  },
}

before(async () => {
  setPlaidGateway(fakePlaid)
  config.integrationKey = randomBytes(32).toString('base64')
  // Data created before any account exists must end up with the first account.
  const { Skill } = await import('../src/models.js')
  await Skill.collection.insertOne({ name: 'Legacy', color: '#000000', startDate: '2026-01-01', logs: [], avgWeeks: 12 })

  const r = await call('POST', '/auth/register', { email: 'First@Example.com', name: 'First', password: PASSWORD })
  assert.equal(r.status, 201)
})

describe('health', () => {
  it('reports the database is connected', async () => {
    const { status, body } = await call('GET', '/health')
    assert.equal(status, 200)
    assert.deepEqual(body, { status: 'ok', db: true })
  })
})

describe('skills', () => {
  let id = ''

  it('creates a skill with defaults and an `id` field', async () => {
    const { status, body } = await call('POST', '/skills', { name: ' Exercise ', startDate: '2026-10-01' })
    assert.equal(status, 201)
    assert.equal(body.name, 'Exercise')
    assert.equal(body.avgWeeks, 12)
    assert.deepEqual(body.logs, [])
    assert.equal(typeof body.id, 'string')
    assert.equal(body._id, undefined)
    assert.equal(body.__v, undefined)
    id = body.id
  })

  it('toggles a day on and off, and moves the start date back when needed', async () => {
    let r = await call('POST', `/skills/${id}/logs/2026-10-05/toggle`)
    assert.deepEqual(r.body.logs, ['2026-10-05'])

    r = await call('POST', `/skills/${id}/logs/2026-09-28/toggle`)
    assert.deepEqual(r.body.logs, ['2026-09-28', '2026-10-05'])
    assert.equal(r.body.startDate, '2026-09-28')

    r = await call('POST', `/skills/${id}/logs/2026-10-05/toggle`)
    assert.deepEqual(r.body.logs, ['2026-09-28'])
  })

  it('updates only the fields sent', async () => {
    const { status, body } = await call('PATCH', `/skills/${id}`, { avgWeeks: 8 })
    assert.equal(status, 200)
    assert.equal(body.avgWeeks, 8)
    assert.deepEqual(body.logs, ['2026-09-28'])
  })

  it('archives a skill, keeps its history, and restores it', async () => {
    assert.equal((await call('GET', `/skills/${id}`)).body.archived, false)
    const away = await call('PATCH', `/skills/${id}`, { archived: true })
    assert.equal(away.body.archived, true)
    assert.deepEqual(away.body.logs, ['2026-09-28'], 'its days are kept')
    assert.equal((await call('PATCH', `/skills/${id}`, { archived: 'yes' })).status, 400)
    assert.equal((await call('PATCH', `/skills/${id}`, { archived: false })).body.archived, false)
  })

  it('labels a habit as performing or eliminating', async () => {
    assert.equal((await call('GET', `/skills/${id}`)).body.kind, 'performing')
    const quit = await call('POST', '/skills', { name: 'No soda', startDate: '2026-10-01', kind: 'eliminating' })
    assert.equal(quit.body.kind, 'eliminating')
    assert.equal((await call('PATCH', `/skills/${quit.body.id}`, { kind: 'performing' })).body.kind, 'performing')
    assert.equal((await call('PATCH', `/skills/${quit.body.id}`, { kind: 'other' })).status, 400)
    await call('DELETE', `/skills/${quit.body.id}`)
  })



  it('lets one habit override whether its streak shows, and go back to following the page', async () => {
    assert.equal((await call('GET', `/skills/${id}`)).body.streakVisible, undefined, 'follows the page by default')
    assert.equal((await call('PATCH', `/skills/${id}`, { streakVisible: false })).body.streakVisible, false)
    assert.equal((await call('PATCH', `/skills/${id}`, { streakVisible: true })).body.streakVisible, true)
    assert.equal((await call('PATCH', `/skills/${id}`, { streakVisible: 'no' })).status, 400)
    const followed = await call('PATCH', `/skills/${id}`, { streakVisible: null })
    assert.equal(followed.status, 200)
    assert.ok(followed.body.streakVisible == null)
  })

  it('changes the start date and colour of a habit', async () => {
    const r = await call('PATCH', `/skills/${id}`, { startDate: '2026-09-01', color: '#16a34a' })
    assert.equal(r.body.startDate, '2026-09-01')
    assert.equal(r.body.color, '#16a34a')
    assert.equal((await call('PATCH', `/skills/${id}`, { color: 'green' })).status, 400)
  })

  it('keeps an optional goal end date, and lets it be taken away', async () => {
    const made = await call('POST', '/skills', { name: 'Goal', startDate: '2026-10-01', endDate: '2026-12-31' })
    assert.equal(made.status, 201)
    assert.equal(made.body.endDate, '2026-12-31')
    assert.equal((await call('PATCH', `/skills/${made.body.id}`, { endDate: '2027-01-31' })).body.endDate, '2027-01-31')
    assert.equal((await call('PATCH', `/skills/${made.body.id}`, { endDate: '2026-09-30' })).status, 400, 'before the start date')
    assert.equal((await call('PATCH', `/skills/${made.body.id}`, { startDate: '2027-02-01' })).status, 400, 'start moved past the end')
    assert.equal((await call('POST', '/skills', { name: 'Bad', startDate: '2026-10-01', endDate: 'someday' })).status, 400)
    assert.equal((await call('POST', '/skills', { name: 'Bad', startDate: '2026-10-05', endDate: '2026-10-01' })).status, 400)
    const cleared = await call('PATCH', `/skills/${made.body.id}`, { endDate: null })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.endDate, undefined)
    await call('DELETE', `/skills/${made.body.id}`)
  })

  it('stops marking days by itself at the goal end date', async () => {
    const made = await call('POST', '/skills?today=2026-10-10', { name: 'Short', startDate: '2026-10-08', endDate: '2026-10-09', autoMark: true })
    assert.deepEqual(made.body.logs, ['2026-10-08', '2026-10-09'])
    const later = (await call('GET', '/skills?today=2026-10-20')).body.find((s: { id: string }) => s.id === made.body.id)
    assert.deepEqual(later.logs, ['2026-10-08', '2026-10-09'])
    const extended = await call('PATCH', `/skills/${made.body.id}?today=2026-10-20`, { endDate: '2026-10-11' })
    assert.deepEqual(extended.body.logs, ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    await call('DELETE', `/skills/${made.body.id}`)
  })

  it('marks every day by itself when asked, and leaves unmarked days alone', async () => {
    const today = '2026-10-10'
    const made = await call('POST', `/skills?today=${today}`, { name: 'Auto', startDate: '2026-10-08', autoMark: true })
    assert.equal(made.status, 201)
    assert.equal(made.body.autoMark, true)
    assert.deepEqual(made.body.logs, ['2026-10-08', '2026-10-09', '2026-10-10'])

    await call('POST', `/skills/${made.body.id}/logs/2026-10-09/toggle`) // unmark one
    const later = (await call('GET', '/skills?today=2026-10-12')).body.find((s: { id: string }) => s.id === made.body.id)
    assert.deepEqual(later.logs, ['2026-10-08', '2026-10-10', '2026-10-11', '2026-10-12'])

    // An earlier start date fills the days before the old one, up to what was already filled.
    const earlier = await call('PATCH', `/skills/${made.body.id}?today=2026-10-12`, { startDate: '2026-10-06' })
    assert.deepEqual(earlier.body.logs, ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10', '2026-10-11', '2026-10-12'])

    // Turning it off keeps the days but stops filling.
    await call('PATCH', `/skills/${made.body.id}`, { autoMark: false })
    const off = (await call('GET', '/skills?today=2026-10-20')).body.find((s: { id: string }) => s.id === made.body.id)
    assert.equal(off.autoMark, false)
    assert.equal(off.logs.length, 6)

    await call('DELETE', `/skills/${made.body.id}`)
  })

  it('dedupes and sorts logs on create', async () => {
    const { body } = await call('POST', '/skills', {
      name: 'Calories',
      startDate: '2026-10-01',
      logs: ['2026-10-03', '2026-10-02', '2026-10-03'],
    })
    assert.deepEqual(body.logs, ['2026-10-02', '2026-10-03'])
  })

  it('rejects invalid input', async () => {
    let r = await call('POST', '/skills', { name: '', startDate: '2026-10-01' })
    assert.equal(r.status, 400)
    r = await call('POST', '/skills', { name: 'x', startDate: 'tomorrow' })
    assert.equal(r.status, 400)
    r = await call('POST', '/skills', { name: 'x', startDate: '2026-10-01', avgWeeks: 99 })
    assert.equal(r.status, 400)
    r = await call('POST', '/skills', { name: 'x', startDate: '2026-10-01', isAdmin: true })
    assert.equal(r.status, 400, 'unknown fields are rejected')
  })

  it('handles bad and missing ids', async () => {
    assert.equal((await call('GET', '/skills/not-an-id')).status, 400)
    assert.equal((await call('GET', '/skills/64b7f0f0f0f0f0f0f0f0f0f0')).status, 404)
  })

  it('deletes a skill', async () => {
    assert.equal((await call('DELETE', `/skills/${id}`)).status, 204)
    assert.equal((await call('GET', `/skills/${id}`)).status, 404)
  })
})

describe('transactions', () => {
  it('stores integer cents and filters by type and date range', async () => {
    const add = (type: string, amountCents: number, date: string) =>
      call('POST', '/transactions', { type, amountCents, category: 'Food', date })

    await add('expense', 8450, '2026-10-01')
    await add('expense', 3200, '2026-10-15')
    await add('income', 320000, '2026-10-20')

    assert.equal((await call('POST', '/transactions', { type: 'expense', amountCents: 12.5, category: 'Food', date: '2026-10-01' })).status, 400)

    const all = await call('GET', '/transactions')
    assert.equal(all.body.length, 3)
    assert.equal(all.body[0].date, '2026-10-20', 'newest first')

    const expenses = await call('GET', '/transactions?type=expense')
    assert.equal(expenses.body.length, 2)

    const mid = await call('GET', '/transactions?from=2026-10-10&to=2026-10-18')
    assert.equal(mid.body.length, 1)
    assert.equal(mid.body[0].amountCents, 3200)
  })

  it('archives a transaction without deleting it, and can restore it', async () => {
    const made = await call('POST', '/transactions', { type: 'expense', amountCents: 999, category: 'Fun', date: '2026-09-01' })
    assert.equal(made.body.archived, false)

    const archived = await call('PATCH', '/transactions/' + made.body.id, { archived: true })
    assert.equal(archived.body.archived, true)
    const listed = (await call('GET', '/transactions?from=2026-09-01&to=2026-09-01')).body
    assert.equal(listed.length, 1, 'still stored and returned, so the page can offer to restore it')
    assert.equal(listed[0].archived, true)

    assert.equal((await call('PATCH', '/transactions/' + made.body.id, { archived: false })).body.archived, false)
    assert.equal((await call('PATCH', '/transactions/' + made.body.id, { archived: 'yes' })).status, 400)
    await call('DELETE', '/transactions/' + made.body.id) // so the other tests' counts stay the same
  })

  it('lists subscriptions, lets you mark or dismiss one, and skips archived charges', async () => {
    const month = (n: number) => {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - n)
      return d.toLocaleDateString('en-CA')
    }
    const ids: string[] = []
    const add = async (note: string, amountCents: number, date: string) => {
      const r = await call('POST', '/transactions', { type: 'expense', amountCents, category: 'Fun', date, note })
      ids.push(r.body.id)
      return r.body.id as string
    }
    const first = await add('Streaming Plus', 999, month(3))
    await add('Streaming Plus', 999, month(2))
    await add('Streaming Plus', 999, month(1))
    // Different amounts, and not in months that follow each other: not found by itself.
    await add('Print Shop', 2600, month(4))
    await add('Print Shop', 9100, month(1))

    const get = async () => (await call('GET', '/subscriptions')).body
    let data = await get()
    assert.deepEqual(data.items.map((i: { name: string }) => i.name), ['Streaming Plus'])
    assert.equal(data.items[0].cadence, 'monthly')
    assert.equal(data.items[0].account, 'Added by hand')
    assert.deepEqual(data.candidates.map((c: { name: string }) => c.name), ['Print Shop'])

    const mark = (name: string, status: string) => call('PUT', '/subscriptions/marks', { account: 'Added by hand', name, status })
    assert.equal((await mark('Print Shop', 'subscription')).status, 204)
    assert.equal((await mark('Streaming Plus', 'not')).status, 204)
    data = await get()
    assert.deepEqual(data.items.map((i: { name: string }) => i.name), ['Print Shop'])
    assert.equal(data.items[0].marked, true)
    assert.deepEqual(data.ignored.map((i: { name: string }) => i.name), ['Streaming Plus'])

    assert.equal((await mark('Streaming Plus', 'clear')).status, 204)
    assert.equal((await mark('Print Shop', 'clear')).status, 204)
    assert.equal((await get()).ignored.length, 0)

    assert.equal((await call('PUT', '/subscriptions/marks', { account: 'Added by hand', name: '!!!', status: 'subscription' })).status, 400)
    assert.equal((await call('PUT', '/subscriptions/marks', { account: 'x', name: 'y', status: 'maybe' })).status, 400)

    await call('PATCH', '/transactions/' + first, { archived: true })
    assert.equal((await get()).items.length, 0, 'two months in a row is not enough')

    assert.equal((await makeClient()('GET', '/subscriptions')).status, 401)
    for (const id of ids) await call('DELETE', '/transactions/' + id)
  })
  it('ignores query operator injection', async () => {
    const r = await call('GET', '/transactions?type[$ne]=income')
    assert.equal(r.status, 200)
    assert.equal(r.body.length, 3, 'object-valued filters are ignored, not executed')
  })
})

describe('hand-added accounts', () => {
  it('lists a card added by hand, validates it, and keeps it private', async () => {
    const created = await call('POST', '/accounts', { name: 'Citi Pay Credit', kind: 'credit', mask: '7946', balanceCents: 0 })
    assert.equal(created.status, 201)
    assert.equal(created.body.kind, 'credit')
    assert.equal(created.body.balanceCents, 0)
    assert.equal((await call('PATCH', '/accounts/' + created.body.id, { balanceCents: 12345 })).body.balanceCents, 12345)
    assert.equal((await call('POST', '/accounts', { name: 'X', kind: 'bank', balanceCents: 1.5 })).status, 400)

    assert.equal((await call('POST', '/accounts', { name: 'X', kind: 'savings' })).status, 400)
    assert.equal((await call('POST', '/accounts', { name: 'X', kind: 'bank', mask: 'abcd' })).status, 400)

    assert.equal((await call('GET', '/accounts')).body.length, 1)
    assert.equal((await makeClient()('GET', '/accounts')).status, 401)
  })
})

describe('account views', () => {
  it('saves a named group of accounts, edits it, and keeps it private', async () => {
    const made = await call('POST', '/views', { name: 'Business', accounts: ['Test Bank · Business Card ••1111'] })
    assert.equal(made.status, 201)
    assert.deepEqual(made.body.accounts, ['Test Bank · Business Card ••1111'])

    const edited = await call('PATCH', '/views/' + made.body.id, { accounts: [], name: 'Work' })
    assert.equal(edited.body.name, 'Work')
    assert.deepEqual(edited.body.accounts, [])

    assert.equal((await call('POST', '/views', { name: '', accounts: [] })).status, 400)
    assert.equal((await call('POST', '/views', { name: 'X', accounts: [''] })).status, 400)

    const other = makeClient()
    await other('POST', '/auth/register', { email: 'views-other@example.com', name: 'Other', password: PASSWORD })
    assert.deepEqual((await other('GET', '/views')).body, [])
    assert.equal((await other('PATCH', '/views/' + made.body.id, { name: 'Hijack' })).status, 404)

    assert.equal((await call('DELETE', '/views/' + made.body.id)).status, 204)
    assert.equal((await call('GET', '/views')).body.length, 0)
  })
})

describe('device groups', () => {
  it('saves a named group of devices, edits it, and keeps it private', async () => {
    const made = await call('POST', '/device-groups', { name: 'Work', devices: ['ANDREWSLAPTOP', 'Galaxy S23'] })
    assert.equal(made.status, 201)
    assert.deepEqual(made.body.devices, ['ANDREWSLAPTOP', 'Galaxy S23'])

    const edited = await call('PATCH', '/device-groups/' + made.body.id, { name: 'Phones', devices: ['Galaxy S23'] })
    assert.equal(edited.body.name, 'Phones')
    assert.deepEqual(edited.body.devices, ['Galaxy S23'])
    assert.deepEqual((await call('GET', '/device-groups')).body.map((g: { name: string }) => g.name), ['Phones'])

    assert.equal((await call('POST', '/device-groups', { name: '', devices: [] })).status, 400)
    assert.equal((await call('POST', '/device-groups', { name: 'X', devices: [''] })).status, 400)

    const other = makeClient()
    await other('POST', '/auth/register', { email: 'groups-other@example.com', name: 'Other', password: PASSWORD })
    assert.deepEqual((await other('GET', '/device-groups')).body, [])
    assert.equal((await other('PATCH', '/device-groups/' + made.body.id, { name: 'Hijack' })).status, 404)

    assert.equal((await call('DELETE', '/device-groups/' + made.body.id)).status, 204)
    assert.equal((await call('GET', '/device-groups')).body.length, 0)
  })
})

describe('page layouts', () => {
  it('saves how a page is arranged, replaces it, resets it, and keeps it private', async () => {
    assert.deepEqual((await call('GET', '/layouts')).body, {})

    const items = [
      { id: 'networth', size: 'full', hidden: false },
      { id: 'budgets', size: 'third', hidden: true },
    ]
    assert.equal((await call('PUT', '/layouts/finance', { items })).status, 200)
    assert.deepEqual((await call('GET', '/layouts')).body, { finance: items })

    const swapped = [...items].reverse()
    await call('PUT', '/layouts/finance', { items: swapped })
    assert.deepEqual((await call('GET', '/layouts')).body.finance, swapped)

    assert.equal((await call('PUT', '/layouts/finance', { items: [{ id: 'a', size: 'huge', hidden: false }] })).status, 400)
    assert.equal(
      (await call('PUT', '/layouts/finance', { items: [{ id: 'a', size: 'full', hidden: false }, { id: 'a', size: 'half', hidden: false }] })).status,
      400,
    )
    assert.equal((await call('PUT', '/layouts/Not%20A%20Page', { items: [] })).status, 400)
    assert.deepEqual((await call('GET', '/layouts')).body.finance, swapped, 'a rejected save changes nothing')

    const other = makeClient()
    await other('POST', '/auth/register', { email: 'layout-other@example.com', name: 'Other', password: PASSWORD })
    assert.deepEqual((await other('GET', '/layouts')).body, {})

    assert.equal((await call('DELETE', '/layouts/finance')).status, 204)
    assert.deepEqual((await call('GET', '/layouts')).body, {})
    assert.equal((await makeClient()('GET', '/layouts')).status, 401)
  })
})

describe('meals and time entries', () => {
  it('defaults a meal to today with zeroed macros', async () => {
    const { status, body } = await call('POST', '/meals', { name: 'Oatmeal', calories: 380 })
    assert.equal(status, 201)
    assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(body.protein, 0)
  })

  it('creates a running timer entry and then stops it', async () => {
    const created = await call('POST', '/time-entries', {
      label: 'Deep work',
      category: 'Work',
      start: '2026-10-28T13:00:00.000Z',
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.end, undefined)

    const stopped = await call('PATCH', `/time-entries/${created.body.id}`, { end: '2026-10-28T14:30:00.000Z' })
    assert.equal(stopped.body.end, '2026-10-28T14:30:00.000Z')

    const inRange = await call('GET', '/time-entries?from=2026-10-28T00:00:00.000Z&to=2026-10-28T23:59:59.999Z')
    assert.equal(inRange.body.length, 1)
    assert.equal((await call('GET', '/time-entries?from=not-a-date')).status, 400)
  })
})

describe('integrations', () => {
  it('lists every planned integration as not connected, and only Crunch, ActivityWatch and the phone app (which need no keys) as available', async () => {
    const { status, body } = await call('GET', '/integrations')
    assert.equal(status, 200)
    assert.deepEqual(
      body.map((i: { id: string }) => i.id),
      ['google-calendar', 'plaid', 'myfitnesspal', 'crunch', 'samsung-screen-time', 'activitywatch'],
    )
    for (const item of body) {
      assert.equal(item.status, 'not_connected')
      assert.equal(item.available, ['crunch', 'activitywatch', 'samsung-screen-time'].includes(item.id))
    }
  })

  it('says for each one whether its API is official, and gives Crunch its members link', async () => {
    const { body } = await call('GET', '/integrations')
    const api = Object.fromEntries(body.map((i: { id: string; api: string }) => [i.id, i.api]))
    assert.deepEqual(api, {
      'google-calendar': 'official',
      plaid: 'official',
      myfitnesspal: 'official',
      crunch: 'unofficial',
      'samsung-screen-time': 'unofficial',
      activitywatch: 'official',
    })
    const crunch = body.find((i: { id: string }) => i.id === 'crunch')
    assert.equal(crunch.category, 'fitness')
    assert.equal(crunch.url, 'https://members.crunch.com/')
  })

  it('answers 501 when connecting something that is not built yet, and 404 for unknown ids', async () => {
    const r = await call('POST', '/integrations/google-calendar/connect')
    assert.equal(r.status, 501)
    assert.match(r.body.error, /Google Calendar/)
    assert.equal((await call('POST', '/integrations/nope/connect')).status, 404)
  })

  it('disconnecting is harmless when nothing is connected', async () => {
    assert.equal((await call('DELETE', '/integrations/plaid/connection')).status, 204)
  })
})

/** Stands in for the Crunch members site. */
const crunch = {
  fail: undefined as CrunchError | undefined,
  calls: [] as string[],
  snapshot: {
    memberId: '123',
    workoutGoal: 4,
    balanceCents: 0,
    checkIns: [
      { id: 'a', at: '2026-10-30T22:00:00.000Z', club: 'Club One' },
      { id: 'b', at: '2026-10-28T11:00:00.000Z', club: 'Club One' },
    ],
    classes: [{ program: 'Yoga', startsAt: '2026-10-05T18:30', club: 'Club One', status: 'attended' }],
    payments: [
      { service: 'Dues', amountCents: 1999, date: '2026-10-01' },
      { service: 'Payment', amountCents: -1999, date: '2026-10-01' },
    ],
  } as CrunchSnapshot,
}
const fakeCrunch: CrunchGateway = {
  fetchAll: async (email, password) => {
    crunch.calls.push(`${email}:${password}`)
    if (crunch.fail) throw crunch.fail
    return crunch.snapshot
  },
}

describe('crunch', () => {
  before(() => setCrunchGateway(fakeCrunch))
  after(() => setCrunchGateway(undefined))

  it('has no data until it is connected', async () => {
    const r = await call('GET', '/integrations/crunch/data')
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { connected: false, checkIns: [], classes: [], payments: [] })
    assert.equal((await call('POST', '/integrations/crunch/sync')).status, 409)
  })

  it('says a wrong password plainly, without signing the person out of Valkyrie', async () => {
    crunch.fail = new CrunchError('BAD_LOGIN', "Crunch didn't accept that email and password.")
    const r = await call('POST', '/integrations/crunch/connect', { email: 'me@example.com', password: 'nope' })
    assert.equal(r.status, 422)
    assert.match(r.body.error, /didn't accept/)
    assert.equal((await call('GET', '/auth/me')).status, 200)
    assert.equal((await call('GET', '/integrations/crunch/data')).body.connected, false)
    crunch.fail = undefined
  })

  it('connects, imports everything, and never returns the password', async () => {
    const r = await call('POST', '/integrations/crunch/connect', { email: 'me@example.com', password: 'hunter2-secret' })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body, { checkIns: 2, classes: 1, payments: 2 })

    const { body } = await call('GET', '/integrations/crunch/data')
    assert.equal(body.connected, true)
    assert.equal(body.email, 'me@example.com')
    assert.equal(body.workoutGoal, 4)
    assert.deepEqual(
      body.checkIns.map((c: { id: string }) => c.id),
      ['a', 'b'], // newest first
    )
    assert.equal(body.classes[0].program, 'Yoga')
    assert.equal(body.payments.length, 2)
    assert.ok(!JSON.stringify(body).includes('hunter2'))

    const { CrunchLink } = await import('../src/models.js')
    const stored = await CrunchLink.findOne({ email: 'me@example.com' }).select('+password')
    assert.ok(stored)
    assert.ok(!stored.password.includes('hunter2'), 'stored encrypted')

    const list = await call('GET', '/integrations')
    const item = list.body.find((i: { id: string }) => i.id === 'crunch')
    assert.equal(item.status, 'connected')
    assert.equal(item.accountLabel, 'me@example.com')
  })

  it('syncs again with the saved login and replaces what was imported', async () => {
    crunch.snapshot = { ...crunch.snapshot, checkIns: [{ id: 'c', at: '2026-11-01T12:00:00.000Z', club: 'Club One' }], workoutGoal: 5 }
    const r = await call('POST', '/integrations/crunch/sync')
    assert.equal(r.status, 200)
    assert.equal(crunch.calls.at(-1), 'me@example.com:hunter2-secret')
    const { body } = await call('GET', '/integrations/crunch/data')
    assert.deepEqual(
      body.checkIns.map((c: { id: string }) => c.id),
      ['c'],
    )
    assert.equal(body.workoutGoal, 5)
    assert.ok(body.lastSyncedAt)
  })

  it('keeps the old data and records why when a sync fails', async () => {
    crunch.fail = new CrunchError('UNEXPECTED', 'Crunch showed an unexpected page after sign-in.')
    const r = await call('POST', '/integrations/crunch/sync')
    assert.equal(r.status, 502)
    const { body } = await call('GET', '/integrations/crunch/data')
    assert.equal(body.checkIns.length, 1)
    assert.match(body.lastError, /unexpected page/)
    crunch.fail = undefined
    await call('POST', '/integrations/crunch/sync')
    assert.equal((await call('GET', '/integrations/crunch/data')).body.lastError, null)
  })

  it("keeps one person's Crunch data away from another's", async () => {
    const other = makeClient()
    const reg = await other('POST', '/auth/register', { email: 'crunch-other@example.com', name: 'Other', password: PASSWORD })
    // Registration may be switched off in this environment; the point only matters if a second account exists.
    if (reg.status === 201) assert.equal((await other('GET', '/integrations/crunch/data')).body.connected, false)
  })

  it('forgets the login and the data when disconnected', async () => {
    assert.equal((await call('DELETE', '/integrations/crunch/connection')).status, 204)
    assert.equal((await call('GET', '/integrations/crunch/data')).body.connected, false)
    const list = await call('GET', '/integrations')
    assert.equal(list.body.find((i: { id: string }) => i.id === 'crunch').status, 'not_connected')
  })
})

describe('crunch bookmark (data sent from the browser)', () => {
  const CRUNCH_SITE = 'https://members.crunch.com'
  const payload = {
    memberId: '123',
    workoutGoal: 4,
    checkIns: [{ id: 1, location: 'Club One', checkin_time: '2026-10-30T22:00:00.000Z', mms_checkin_id: 'x1' }],
    classes: [{ program_name: 'Yoga', occurrence_start_time: '2026-10-05 06:30pm', club: { name: 'Club One' }, status: 'attended', fee_amount: null }],
    billing: { invoices: [{ mms_club_id: '1', amount: '19.99', service_name: 'Dues', purchase_date: '10/01/26' }], total_balance: '0.00' },
  }
  /** What the bookmark does: a plain request from the Crunch site, with no Valkyrie sign-in cookie. */
  const send = (token: string | undefined, body: unknown = payload, origin = CRUNCH_SITE) =>
    fetch(`${base}/integrations/crunch/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  let token = ''

  it('only gives the bookmark secret to a signed-in person', async () => {
    assert.equal((await makeClient()('POST', '/integrations/crunch/import-token')).status, 401)
    const r = await call('POST', '/integrations/crunch/import-token')
    assert.equal(r.status, 201)
    assert.ok(r.body.token.length >= 40)
    token = r.body.token
    const { CrunchImportToken } = await import('../src/models.js')
    assert.equal(await CrunchImportToken.countDocuments({ tokenHash: token }), 0, 'only a hash is stored')
  })

  it('answers the browser check from the Crunch site, and only from there', async () => {
    const ask = (origin: string) =>
      fetch(`${base}/integrations/crunch/import`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
          'access-control-request-private-network': 'true',
        },
      })
    const ok = await ask(CRUNCH_SITE)
    assert.equal(ok.status, 204)
    assert.equal(ok.headers.get('access-control-allow-origin'), CRUNCH_SITE)
    assert.equal(ok.headers.get('access-control-allow-private-network'), 'true')
    // Another site is told the only allowed site is Crunch's, so its browser refuses to let it read the answer.
    assert.equal((await ask('https://evil.example')).headers.get('access-control-allow-origin'), CRUNCH_SITE)
  })

  it('imports with the secret, without a Valkyrie sign-in, and marks the link as not refreshable by Valkyrie', async () => {
    const res = await send(token)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), CRUNCH_SITE)
    assert.deepEqual(await res.json(), { checkIns: 1, classes: 1, payments: 1 })

    const { body } = await call('GET', '/integrations/crunch/data')
    assert.equal(body.connected, true)
    assert.equal(body.autoSync, false)
    assert.equal(body.email, null)
    assert.equal(body.workoutGoal, 4)
    assert.equal(body.checkIns[0].id, 'x1')
    assert.equal(body.classes[0].startsAt, '2026-10-05T18:30')
    assert.equal(body.payments[0].amountCents, 1999)
    const list = await call('GET', '/integrations')
    assert.equal(list.body.find((i: { id: string }) => i.id === 'crunch').status, 'connected')
  })

  it('has nothing to sign in with, and says what to do instead', async () => {
    const r = await call('POST', '/integrations/crunch/sync')
    assert.equal(r.status, 409)
    assert.match(r.body.error, /Send to Valkyrie/)
  })

  it('refuses a missing, wrong or replaced secret, and Crunch data in a shape it does not know', async () => {
    assert.equal((await send(undefined)).status, 401)
    assert.equal((await send('nope')).status, 401)
    assert.equal((await send(token, { ...payload, checkIns: { oops: true } })).status, 400)
    assert.equal((await send(token, { ...payload, memberId: 'x; drop' })).status, 400)

    const fresh = await call('POST', '/integrations/crunch/import-token')
    assert.equal((await send(token)).status, 401, 'the old bookmark stops working')
    assert.equal((await send(fresh.body.token)).status, 200)
    token = fresh.body.token
  })

  it('stops working once Crunch is disconnected', async () => {
    assert.equal((await call('DELETE', '/integrations/crunch/connection')).status, 204)
    assert.equal((await send(token)).status, 401)
    assert.equal((await call('GET', '/integrations/crunch/data')).body.connected, false)
  })
})

describe('activitywatch', () => {
  type Call = { timeperiods: string[]; query: string[] }
  const fake = {
    running: true,
    calls: [] as Call[],
    // What "ActivityWatch" answers for the app query and the website query, by day index (the last day is today).
    apps: (i: number, last: number) =>
      i === last ? [{ duration: 3600.4, data: { app: 'chrome.exe' } }, { duration: 1200, data: { app: 'Code.exe' } }, { duration: 0.2, data: { app: 'tiny.exe' } }] : [],
    web: (i: number, last: number) =>
      i === last
        ? [
            { duration: 1800, data: { url: 'https://www.YouTube.com/watch?v=1' } },
            { duration: 600, data: { url: 'https://youtube.com/feed' } },
            { duration: 300, data: { url: 'chrome://extensions/' } },
            { duration: 100, data: { url: 'not a url' } },
          ]
        : [],
  }
  before(async () => {
    const { setActivityWatchGateway } = await import('../src/integrations/activityWatch.js')
    setActivityWatchGateway({
      info: async () => (fake.running ? { hostname: 'DESKTOP-AW', version: 'v0.13.2' } : null),
      buckets: async () => [
        { id: 'aw-watcher-window_DESKTOP-AW', type: 'currentwindow', client: 'aw-watcher-window', hostname: 'DESKTOP-AW' },
        { id: 'aw-watcher-afk_DESKTOP-AW', type: 'afkstatus', client: 'aw-watcher-afk', hostname: 'DESKTOP-AW' },
        { id: 'aw-watcher-web-chrome_DESKTOP-AW', type: 'web.tab.current', client: 'aw-client-web', hostname: 'DESKTOP-AW' },
        { id: 'aw-watcher-window_OTHER-PC', type: 'currentwindow', client: 'aw-watcher-window', hostname: 'OTHER-PC' },
      ],
      query: async (timeperiods, query) => {
        fake.calls.push({ timeperiods, query })
        const last = timeperiods.length - 1
        const isWeb = query.some((l) => l.includes('web = '))
        return timeperiods.map((_p, i) => (isWeb ? fake.web(i, last) : fake.apps(i, last)))
      },
    })
  })

  it('says it is not running, and refuses to connect until it is', async () => {
    fake.running = false
    const s = await call('GET', '/integrations/activitywatch')
    assert.equal(s.status, 200)
    assert.equal(s.body.running, false)
    assert.equal(s.body.connected, false)
    assert.equal((await call('POST', '/integrations/activitywatch/connect')).status, 409)
    assert.equal((await call('POST', '/integrations/activitywatch/sync')).status, 409, 'not connected yet')
    fake.running = true
  })

  it("finds this computer's watchers", async () => {
    const s = await call('GET', '/integrations/activitywatch')
    assert.equal(s.body.running, true)
    assert.equal(s.body.hostname, 'DESKTOP-AW')
    assert.deepEqual(s.body.watchers, { window: true, afk: true, web: 1 })
  })

  it('connects, reads a month, and keeps only app names, site names and seconds', async () => {
    fake.calls = []
    const r = await call('POST', '/integrations/activitywatch/connect')
    assert.equal(r.status, 200)
    assert.equal(r.body.days, 30)
    assert.equal(r.body.apps, 2, 'a fraction of a second is dropped')
    assert.equal(r.body.sites, 1, 'chrome:// pages and junk are not websites, and youtube.com adds up')
    assert.equal(r.body.status.connected, true)

    // It asked for this computer's buckets only, in 30 whole days.
    const [appCall] = fake.calls
    assert.equal(appCall.timeperiods.length, 30)
    assert.ok(appCall.query.some((l) => l.includes('aw-watcher-window_DESKTOP-AW')))
    assert.ok(appCall.query.some((l) => l.includes('aw-watcher-afk_DESKTOP-AW')))
    assert.ok(!appCall.query.some((l) => l.includes('OTHER-PC')))
    assert.ok(fake.calls[1].query.some((l) => l.includes('aw-watcher-web-chrome_DESKTOP-AW')))

    const { body } = await call('GET', '/integrations/screen-time/data')
    assert.deepEqual(
      body.usage.map((u: { app: string; seconds: number }) => [u.app, u.seconds]).sort(),
      [['Code', 1200], ['chrome', 3600]],
    )
    assert.deepEqual(body.sites.map((s: { site: string; seconds: number }) => [s.site, s.seconds]), [['youtube.com', 2400]])
    const list = await call('GET', '/integrations')
    assert.equal(list.body.find((i: { id: string }) => i.id === 'activitywatch').status, 'connected')
  })

  it('replaces the days it reads instead of adding to them', async () => {
    fake.apps = (i, last) => (i === last ? [{ duration: 600, data: { app: 'chrome.exe' } }] : [])
    const r = await call('POST', '/integrations/activitywatch/sync')
    assert.equal(r.status, 200)
    assert.equal(r.body.days, 3)
    const { body } = await call('GET', '/integrations/screen-time/data')
    assert.deepEqual(body.usage.map((u: { app: string; seconds: number }) => [u.app, u.seconds]), [['chrome', 600]])
  })

  it('gives a picture for a site or app in your own totals, and only those', async () => {
    const { setIconSources } = await import('../src/integrations/icons.js')
    const asked: string[] = []
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    setIconSources({
      site: async (d) => (asked.push(`site:${d}`), d === 'youtube.com' ? { type: 'image/png', data: png } : null),
      app: async (n) => (asked.push(`app:${n}`), n === 'chrome' ? { type: 'image/png', data: png } : null),
    })
    const get = (q: string) => call('GET', `/integrations/screen-time/icon?${q}`)

    const site = await get('kind=site&name=youtube.com')
    assert.equal(site.status, 200)
    assert.equal(site.headers.get('content-type'), 'image/png')
    assert.match(site.headers.get('content-security-policy') ?? '', /sandbox/)
    assert.deepEqual(site.bytes, png)
    assert.equal((await get('kind=app&name=chrome')).status, 200)

    // Not in your totals: never looked up. In your totals but no picture found: 404, and the page shows a letter.
    assert.equal((await get('kind=site&name=internal.example')).status, 404)
    assert.equal((await get('kind=site&name=localhost')).status, 404)
    assert.equal((await get('kind=app&name=Code')).status, 404)
    assert.equal((await get('kind=nope&name=x')).status, 404)
    assert.ok(!asked.includes('site:internal.example') && !asked.includes('site:localhost'))
    assert.equal((await makeClient()('GET', '/integrations/screen-time/icon?kind=site&name=youtube.com')).status, 401, 'needs a sign-in')
  })

  it("clears out what Valkyrie's old agent sent, and leaves what came from ActivityWatch", async () => {
    const { ScreenTimeUsage, removeOldScreenTimeData } = await import('../src/models.js')
    const { default: mongoose } = await import('mongoose')
    const userId = new mongoose.Types.ObjectId()
    const row = { userId, device: 'PC', day: '2026-11-01', seconds: 60 }
    await ScreenTimeUsage.collection.insertMany([
      { ...row, app: 'old-agent' }, // from before `source` existed
      { ...row, app: 'old-agent-2', source: '' },
      { ...row, app: 'kept', source: 'activitywatch' },
      { ...row, app: 'kept-phone', source: 'phone' },
    ])
    await removeOldScreenTimeData()
    const left = await ScreenTimeUsage.collection.find({ userId }).toArray()
    assert.deepEqual(left.map((r) => r.app).sort(), ['kept', 'kept-phone'])
    await ScreenTimeUsage.collection.deleteMany({ userId })
  })

  it('forgets what it read when disconnected', async () => {
    assert.equal((await call('DELETE', '/integrations/activitywatch/connection')).status, 204)
    const { body } = await call('GET', '/integrations/screen-time/data')
    assert.deepEqual(body, { usage: [], sites: [], phoneDays: [], categories: [] })
    assert.equal((await call('GET', '/integrations/activitywatch')).body.connected, false)
  })
})
describe('accounts', () => {
  it('gave the first account the data saved before accounts existed', async () => {
    const { body } = await call('GET', '/skills')
    assert.ok(body.some((s: { name: string }) => s.name === 'Legacy'))
  })

  it('requires sign-in for data routes but not for health or auth', async () => {
    const anon = makeClient()
    assert.equal((await anon('GET', '/skills')).status, 401)
    assert.equal((await anon('GET', '/integrations')).status, 401)
    assert.equal((await anon('GET', '/auth/me')).status, 401)
    assert.equal((await anon('GET', '/health')).status, 200)
  })

  it('returns the profile without secrets, with a lowercased email', async () => {
    const { status, body } = await call('GET', '/auth/me')
    assert.equal(status, 200)
    assert.equal(body.email, 'first@example.com')
    assert.equal(body.name, 'First')
    assert.equal(body.passwordHash, undefined)
  })

  it('sets an httpOnly session cookie and stores only a hash of it', async () => {
    const other = makeClient()
    const r = await other('POST', '/auth/login', { email: 'first@example.com', password: PASSWORD })
    assert.equal(r.status, 200)
    assert.match(r.setCookie ?? '', /HttpOnly/i)
    assert.match(r.setCookie ?? '', /SameSite=Lax/i)
    const token = (r.setCookie ?? '').split(';')[0].split('=')[1]
    const { Session } = await import('../src/models.js')
    assert.equal(await Session.countDocuments({ tokenHash: token }), 0)
  })

  it('rejects duplicate emails, weak passwords and unknown fields', async () => {
    const anon = makeClient()
    const ok = { email: 'first@example.com', name: 'Dup', password: PASSWORD }
    assert.equal((await anon('POST', '/auth/register', ok)).status, 409)
    assert.equal((await anon('POST', '/auth/register', { ...ok, email: 'x@example.com', password: 'short' })).status, 400)
    assert.equal((await anon('POST', '/auth/register', { ...ok, email: 'not-an-email' })).status, 400)
    assert.equal((await anon('POST', '/auth/register', { ...ok, email: 'y@example.com', isAdmin: true })).status, 400)
  })

  it('gives the same error for a wrong password and an unknown email', async () => {
    const anon = makeClient()
    const wrong = await anon('POST', '/auth/login', { email: 'first@example.com', password: 'nope-nope-nope' })
    const unknown = await anon('POST', '/auth/login', { email: 'ghost@example.com', password: 'nope-nope-nope' })
    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    assert.equal(wrong.body.error, unknown.body.error)
  })

  it('locks out repeated failed sign-ins', async () => {
    const anon = makeClient()
    let last = 0
    for (let i = 0; i < 12; i++) {
      last = (await anon('POST', '/auth/login', { email: 'victim@example.com', password: 'wrong-password' })).status
    }
    assert.equal(last, 429)
  })

  it('keeps each account’s data private', async () => {
    const second = makeClient()
    const reg = await second('POST', '/auth/register', { email: 'second@example.com', name: 'Second', password: PASSWORD })
    assert.equal(reg.status, 201)

    assert.equal((await second('GET', '/skills')).body.length, 0, 'a new account starts empty')

    const mine = await call('POST', '/skills', { name: 'Private', startDate: '2026-10-01' })
    const id = mine.body.id
    assert.equal((await second('GET', `/skills/${id}`)).status, 404)
    assert.equal((await second('PATCH', `/skills/${id}`, { name: 'Hacked' })).status, 404)
    assert.equal((await second('POST', `/skills/${id}/logs/2026-10-02/toggle`)).status, 404)
    assert.equal((await second('DELETE', `/skills/${id}`)).status, 404)
    assert.equal((await call('GET', `/skills/${id}`)).body.name, 'Private')

    // Even if a client tries to claim ownership.
    assert.equal((await second('POST', '/skills', { name: 'x', startDate: '2026-10-01', userId: mine.body.id })).status, 400)
  })

  it('refuses new sign-ups when registration is turned off', async () => {
    const { config } = await import('../src/config.js')
    config.allowRegistration = false
    try {
      const r = await makeClient()('POST', '/auth/register', { email: 'late@example.com', name: 'Late', password: PASSWORD })
      assert.equal(r.status, 403)
    } finally {
      config.allowRegistration = true
    }
  })

  it('blocks writes from a foreign origin', async () => {
    const r = await call('POST', '/skills', { name: 'CSRF', startDate: '2026-10-01' }, { origin: 'https://evil.example' })
    assert.equal(r.status, 403)
    const ok = await call('POST', '/skills', { name: 'Fine', startDate: '2026-10-01' }, { origin: 'http://localhost:5173' })
    assert.equal(ok.status, 201)
  })

  it('updates the name, and signing out ends the session', async () => {
    const me = makeClient()
    await me('POST', '/auth/login', { email: 'first@example.com', password: PASSWORD })
    const patched = await me('PATCH', '/auth/me', { name: '  Renamed ' })
    assert.equal(patched.body.name, 'Renamed')
    assert.equal((await me('PATCH', '/auth/me', { email: 'steal@example.com' })).status, 400)

    const stale = (await me('GET', '/auth/me')).status
    assert.equal(stale, 200)
    assert.equal((await me('POST', '/auth/logout')).status, 204)
    assert.equal((await me('GET', '/auth/me')).status, 401)
  })
})

describe('plaid', () => {
  const tx = (id: string, amount: number, extra: Partial<PlaidTx> = {}): PlaidTx => ({
    id,
    accountId: 'acc1',
    amount,
    date: '2026-10-20',
    name: `Merchant ${id}`,
    ...extra,
  })
  const page = (p: Partial<SyncPage>): SyncPage => ({
    added: [],
    modified: [],
    removed: [],
    nextCursor: 'c1',
    hasMore: false,
    accounts: [
      { accountId: 'acc1', name: 'Checking', mask: '0000', type: 'depository' },
      { accountId: 'acc2', name: 'Business Card', mask: '1111', type: 'credit' },
    ],
    ...p,
  })
  const plaidTxns = async (client = call) =>
    (await client('GET', '/transactions')).body.filter((t: { source: string }) => t.source === 'plaid')

  it('says so clearly when the server has no Plaid keys', async () => {
    const r = await call('POST', '/integrations/plaid/link-token')
    assert.equal(r.status, 503)
    assert.equal((await call('POST', '/integrations/plaid/sync')).status, 503)
  })

  it('requires sign-in', async () => {
    assert.equal((await makeClient()('POST', '/integrations/plaid/link-token')).status, 401)
  })

  it('creates a link token once configured', async () => {
    plaid.configured = true
    const r = await call('POST', '/integrations/plaid/link-token')
    assert.equal(r.status, 200)
    assert.match(r.body.linkToken, /^link-sandbox-/)
    assert.equal((await call('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'plaid').available, true)
  })

  it('trades the public token, stores the access token encrypted, and imports transactions', async () => {
    plaid.pages = [
      page({
        added: [
          tx('t1', 6.33, { primaryCategory: 'FOOD_AND_DRINK', merchantName: 'Chipotle' }),
          tx('t2', -500, { name: 'Paycheck' }),
          tx('t3', 1200, { primaryCategory: 'RENT_AND_UTILITIES' }),
          tx('skip-transfer', 300, { primaryCategory: 'TRANSFER_OUT' }),
          tx('skip-zero', 0),
        ],
        hasMore: true,
        nextCursor: 'c1',
      }),
      page({ added: [tx('t4', 20.1, { primaryCategory: 'ENTERTAINMENT', date: '2026-10-21' })], nextCursor: 'c2' }),
    ]
    const r = await call('POST', '/integrations/plaid/exchange', { publicToken: 'abc', institutionName: 'Ignored' })
    assert.equal(r.status, 201)
    assert.equal(r.body.institution, 'Test Bank')
    assert.equal(r.body.sync.added, 6)

    const { PlaidItem } = await import('../src/models.js')
    const stored = await PlaidItem.collection.findOne({ itemId: 'item-abc' })
    assert.ok(stored)
    assert.ok(!JSON.stringify(stored).includes('access-sandbox-abc'), 'the token is not stored in plain text')
    assert.match(String(stored.accessToken), /^v1\./)
    assert.equal(stored.cursor, 'c2')
    assert.deepEqual(plaid.cursorsSeen, [undefined, 'c1'], 'the second page continues from the first cursor')

    const list = await plaidTxns()
    assert.equal(list.length, 4, 'the transfer and the zero amount are skipped')
    const by = (note: string) => list.find((t: { note: string }) => t.note === note)
    assert.deepEqual(
      [by('Chipotle').type, by('Chipotle').amountCents, by('Chipotle').category, by('Chipotle').accountName],
      ['expense', 633, 'Food', 'Test Bank · Checking ••0000'],
    )
    assert.deepEqual([by('Paycheck').type, by('Paycheck').amountCents], ['income', 50000])
    assert.equal(by('Merchant t3').category, 'Rent')
    assert.equal(by('Merchant t4').category, 'Fun')
    assert.equal(by('Chipotle').externalId, 't1')
    assert.equal(by('Chipotle').accountId, 'acc1')
  })

  it('never sends the access token to the browser', async () => {
    const texts = [
      JSON.stringify((await call('GET', '/integrations')).body),
      JSON.stringify((await call('GET', '/transactions')).body),
    ]
    for (const text of texts) assert.ok(!text.includes('access-sandbox') && !text.includes('accessToken'))
  })

  it('shows the bank as connected', async () => {
    const plaidRow = (await call('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'plaid')
    assert.equal(plaidRow.status, 'connected')
    assert.equal(plaidRow.accountLabel, 'Test Bank')
  })

  it('syncs again without duplicating, applying changes and removals', async () => {
    plaid.pages = [
      page({
        added: [tx('t5', 4)],
        modified: [tx('t1', 7.5, { primaryCategory: 'FOOD_AND_DRINK', merchantName: 'Chipotle' }), tx('t3', 1200, { primaryCategory: 'TRANSFER_OUT' })],
        removed: ['t4'],
        nextCursor: 'c3',
      }),
    ]
    const r = await call('POST', '/integrations/plaid/sync')
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.added, r.body.modified, r.body.removed], [1, 2, 1])

    const list = await plaidTxns()
    assert.equal(list.length, 3)
    assert.equal(list.find((t: { externalId: string }) => t.externalId === 't1').amountCents, 750)
    assert.ok(!list.some((t: { externalId: string }) => t.externalId === 't4'), 'removed by the bank')
    assert.ok(!list.some((t: { externalId: string }) => t.externalId === 't3'), 'now classed as a transfer')
  })

  it('refetches imports made by an older version of the importer, once', async () => {
    const { PlaidItem, Transaction } = await import('../src/models.js')
    await PlaidItem.collection.updateMany({}, { $unset: { syncVersion: 1 } })
    await Transaction.collection.updateMany({ source: 'plaid' }, { $unset: { accountId: 1, accountName: 1 } })
    plaid.cursorsSeen = []
    plaid.pages = [
      page({
        added: [tx('t1', 7.5, { primaryCategory: 'FOOD_AND_DRINK', merchantName: 'Chipotle' }), tx('t2', -500, { name: 'Paycheck' }), tx('t5', 4)],
        nextCursor: 'c9',
      }),
    ]
    assert.equal((await call('POST', '/integrations/plaid/sync')).status, 200)
    assert.deepEqual(plaid.cursorsSeen, [undefined], 'started from the beginning')
    const rows = await plaidTxns()
    assert.ok(rows.every((t: { accountId?: string }) => t.accountId === 'acc1'))
    assert.equal(rows.find((t: { externalId: string }) => t.externalId === 't1').accountName, 'Test Bank · Checking ••0000')

    plaid.cursorsSeen = []
    await call('POST', '/integrations/plaid/sync')
    assert.deepEqual(plaid.cursorsSeen, ['c9'], 'later syncs continue from the saved cursor')
  })
  it('treats money back onto a credit card as a refund, never as income', async () => {
    plaid.pages = [
      page({
        added: [
          tx('c1', 40, { accountId: 'acc2', primaryCategory: 'FOOD_AND_DRINK', merchantName: 'Diner' }),
          tx('c2', -12.5, { accountId: 'acc2', name: 'Return: Shirt', primaryCategory: 'GENERAL_MERCHANDISE' }),
          tx('c3', -300, { accountId: 'acc2', name: 'ONLINE PAYMENT - THANK YOU' }),
          tx('c4', -80, { accountId: 'acc1', name: 'Deposit' }),
        ],
        nextCursor: 'c10',
      }),
    ]
    assert.equal((await call('POST', '/integrations/plaid/sync')).status, 200)
    const rows = await plaidTxns()
    const by = (id: string) => rows.find((t: { externalId: string }) => t.externalId === id)
    assert.deepEqual([by('c1').type, by('c1').isRefund], ['expense', false])
    assert.deepEqual([by('c2').type, by('c2').isRefund, by('c2').amountCents], ['expense', true, 1250])
    assert.equal(by('c3'), undefined, 'a card payment is not counted')
    assert.deepEqual([by('c4').type, by('c4').isRefund], ['income', false], 'a deposit into checking is still income')
    assert.ok(
      !rows.some((t: { accountName: string; type: string }) => t.accountName?.includes('Business Card') && t.type === 'income'),
      'no income on the credit card',
    )
  })

  it('lists every account, and keeps syncing the other banks when one fails', async () => {
    plaid.pages = []
    const second = await call('POST', '/integrations/plaid/exchange', { publicToken: 'two' })
    assert.equal(second.status, 201)

    const accounts = (await call('GET', '/integrations/plaid/accounts')).body
    assert.ok(accounts.some((a: { label: string; type: string }) => a.label === 'Test Bank · Business Card ••1111' && a.type === 'credit'))
    const balanceOf = (label: string) => accounts.find((a: { label: string }) => a.label === label)?.balanceCents
    assert.equal(balanceOf('Test Bank · Checking ••0000'), 120050, 'balances are stored as whole cents')
    assert.equal(balanceOf('Test Bank · Business Card ••1111'), 30025, 'a card balance is what is owed')
    assert.equal(balanceOf('Test Bank · Business Checking ••3333'), undefined, 'no balance from the bank yet')
    assert.ok(accounts.some((a: { label: string }) => a.label === 'Test Bank · Checking ••0000'))
    assert.ok(
      accounts.some((a: { label: string }) => a.label === 'Test Bank · Business Checking ••3333'),
      'an account with no transactions is listed too',
    )

    plaid.failTokens = ['access-sandbox-abc']
    plaid.pages = [page({ added: [tx('d1', 9)], nextCursor: 'c11' })]
    const r = await call('POST', '/integrations/plaid/sync')
    plaid.failTokens = []
    assert.equal(r.status, 200)
    assert.equal(r.body.errors.length, 1)
    assert.match(r.body.errors[0].message, /Bank is down/)
    assert.equal(r.body.added, 1, 'the working bank still synced')
  })
  it('keeps one account’s banks and transactions out of another', async () => {
    const other = makeClient()
    await other('POST', '/auth/register', { email: 'plaid-other@example.com', name: 'Other', password: PASSWORD })
    assert.equal((await plaidTxns(other)).length, 0)
    assert.deepEqual((await other('GET', '/integrations/plaid/accounts')).body, [])
    assert.equal((await other('POST', '/integrations/plaid/sync')).status, 409, 'no bank connected for this user')
    const row = (await other('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'plaid')
    assert.equal(row.status, 'not_connected')
  })

  it('reports Plaid failures as a 502 and stores nothing', async () => {
    plaid.failExchange = true
    const r = await call('POST', '/integrations/plaid/exchange', { publicToken: 'bad' })
    plaid.failExchange = false
    assert.equal(r.status, 502)
    assert.match(r.body.error, /Bad token/)
    assert.equal((await call('POST', '/integrations/plaid/exchange', { nope: 1 })).status, 400)
  })

  it('disconnecting removes the bank at Plaid and the imported transactions, but keeps manual ones', async () => {
    const manual = await call('POST', '/transactions', { type: 'expense', amountCents: 100, category: 'Food', date: '2026-10-22' })
    assert.equal(manual.status, 201)

    assert.equal((await call('DELETE', '/integrations/plaid/connection')).status, 204)
    assert.ok(plaid.removedTokens.includes('access-sandbox-abc'))
    assert.equal((await plaidTxns()).length, 0)
    assert.ok((await call('GET', '/transactions')).body.some((t: { id: string }) => t.id === manual.body.id))
    const row = (await call('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'plaid')
    assert.equal(row.status, 'not_connected')
    plaid.configured = false
  })
})

describe('general', () => {
  it('returns JSON 404s and 400 for malformed JSON', async () => {
    assert.equal((await call('GET', '/nope')).status, 404)
    const res = await fetch(`${base}/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    })
    assert.equal(res.status, 400)
  })
})

describe('icon helpers', () => {
  it('only ever looks up real public website names', async () => {
    const { isPublicDomain } = await import('../src/integrations/icons.js')
    for (const ok of ['youtube.com', 'docs.google.com', 'a-b.co.uk']) assert.ok(isPublicDomain(ok), ok)
    for (const bad of ['localhost', '127.0.0.1', '10.0.0.5', '[::1]', 'printer.local', 'nas.lan', 'x', 'a b.com', 'evil.com/path', 'user@evil.com', 'evil.com:8080', ''])
      assert.ok(!isPublicDomain(bad), bad)
  })

  it('finds the icon a page names, and only a usable one', async () => {
    const { iconLink } = await import('../src/integrations/icons.js')
    const page = `<head><link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/img/fav.png"></head>`
    assert.equal(iconLink(page, 'https://example.com/'), 'https://example.com/img/fav.png')
    assert.equal(iconLink(`<link href='//cdn.example.com/i.ico' rel='icon'>`, 'https://example.com/'), 'https://cdn.example.com/i.ico')
    assert.equal(iconLink('<link rel="icon" href="data:image/png;base64,AAAA">', 'https://example.com/'), undefined)
    assert.equal(iconLink('<p>nothing</p>', 'https://example.com/'), undefined)
  })

  it('refuses app names that could do anything but name a program', async () => {
    const { isAppName } = await import('../src/integrations/icons.js')
    for (const ok of ['chrome', 'Cursor', 'Spotify', 'Discord']) assert.ok(isAppName(ok), ok)
    for (const bad of ['', '..\\x', 'a/b', 'a;b', '$(x)', 'x'.repeat(200)]) assert.ok(!isAppName(bad), bad)
  })
})

describe('phone', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fake-image-bytes')])
  const phone = makeClient() // the phone app: no cookie, only its own key
  let token = ''
  let deviceId = ''
  const asPhone = (method: string, path: string, body?: unknown, key = token) => phone(method, `/phone${path}`, body, { authorization: `Bearer ${key}` })
  const day = '2026-10-31'

  it('makes a code that pairs a phone once, and not with a wrong one', async () => {
    const made = await call('POST', '/integrations/phone/pair-code')
    assert.equal(made.status, 201)
    assert.match(made.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    assert.ok(Array.isArray(made.body.addresses))

    assert.equal((await phone('POST', '/phone/pair', { code: 'AAAA-AAAA', name: 'Galaxy S23' })).status, 400)
    // Typed with the dash or without, in any case.
    const ok = await phone('POST', '/phone/pair', { code: made.body.code.toLowerCase().replace('-', ' '), name: 'Galaxy S23' })
    assert.equal(ok.status, 201)
    assert.ok(ok.body.token.length > 30)
    token = ok.body.token
    assert.equal((await phone('POST', '/phone/pair', { code: made.body.code, name: 'Again' })).status, 400, 'a code works once')

    const list = await call('GET', '/integrations/phone')
    assert.deepEqual(list.body.devices.map((d: { name: string }) => d.name), ['Galaxy S23'])
    deviceId = list.body.devices[0].id
    assert.equal(JSON.stringify(list.body).includes(token), false, 'the key is never shown again')
    const connected = (await call('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'samsung-screen-time')
    assert.equal(connected.status, 'connected')
  })

  it('offers the secure tunnel address first when there is one', async () => {
    const before = config.clientOrigin
    config.clientOrigin = 'https://my-name.ngrok.dev'
    try {
      const made = await call('POST', '/integrations/phone/pair-code')
      assert.equal(made.body.addresses[0], 'https://my-name.ngrok.dev')
      assert.equal(made.body.listening, true)
    } finally {
      config.clientOrigin = before
    }
  })

  it('only talks to a phone that has its key', async () => {
    assert.equal((await asPhone('GET', '/status')).body.name, 'Galaxy S23')
    assert.equal((await asPhone('GET', '/status', undefined, 'wrong')).status, 401)
    assert.equal((await phone('GET', '/phone/status')).status, 401)
    assert.equal((await asPhone('POST', '/sync', { days: [] })).status, 400)
  })

  it('stores what the phone sends, replaces a day on a repeat, and shows it as phone time', async () => {
    const first = await asPhone('POST', '/sync', {
      days: [{ day, apps: [{ app: 'YouTube', seconds: 3600 }, { app: 'Instagram', seconds: 600 }, { app: 'Instagram', seconds: 60 }] }],
    })
    assert.equal(first.status, 200)
    assert.equal(first.body.apps, 2, 'two lines with one name are one line')
    assert.deepEqual([...first.body.wantIcons].sort(), ['Instagram', 'YouTube'])

    const read = async () => (await call('GET', '/integrations/screen-time/data')).body.usage.filter((u: { kind: string }) => u.kind === 'phone')
    assert.deepEqual(
      (await read()).map((u: { app: string; seconds: number; device: string }) => [u.device, u.app, u.seconds]).sort(),
      [['Galaxy S23', 'Instagram', 660], ['Galaxy S23', 'YouTube', 3600]],
    )

    await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'YouTube', seconds: 4000 }] }] })
    assert.deepEqual((await read()).map((u: { app: string; seconds: number }) => [u.app, u.seconds]), [['YouTube', 4000]], 'replaced, not added to')
    assert.equal((await asPhone('POST', '/sync', { days: [{ day: 'yesterday', apps: [] }] })).status, 400)
    assert.equal((await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'X', seconds: 999999 }] }] })).status, 400)

    const device = (await call('GET', '/integrations/phone')).body.devices[0]
    assert.ok(device.lastSyncedAt)
  })

  it("keeps the pictures the phone sends, and only real pictures of apps it reported", async () => {
    const wanted = (await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'YouTube', seconds: 4000 }, { app: 'Maps', seconds: 90 }] }] })).body.wantIcons
    assert.deepEqual([...wanted].sort(), ['Maps', 'YouTube'])

    const saved = await asPhone('POST', '/icons', {
      icons: { YouTube: png.toString('base64'), Maps: Buffer.from('<svg onload=alert(1)>').toString('base64'), Stranger: png.toString('base64') },
    })
    assert.equal(saved.body.saved, 1, 'not a PNG, and not an app it sent, are both skipped')

    const icon = await call('GET', '/integrations/screen-time/icon?kind=app&source=phone&name=YouTube')
    assert.equal(icon.status, 200)
    assert.equal(icon.headers.get('content-type'), 'image/png')
    assert.deepEqual(icon.bytes, png)
    assert.equal((await call('GET', '/integrations/screen-time/icon?kind=app&source=phone&name=Maps')).status, 404)
    assert.equal((await call('GET', '/integrations/screen-time/icon?kind=app&source=phone&name=Stranger')).status, 404)
    const after = (await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'YouTube', seconds: 4000 }, { app: 'Maps', seconds: 90 }] }] })).body.wantIcons
    assert.deepEqual(after, ['Maps'], 'it only asks again for what it still has no picture of')
  })

  it('keeps the unlocks and notifications the phone sends, replaces a day, and leaves days it sent none for', async () => {
    const phoneDays = async () => (await call('GET', '/integrations/screen-time/data')).body.phoneDays
    const sent = await asPhone('POST', '/sync', {
      days: [{ day, apps: [{ app: 'YouTube', seconds: 60 }], unlocks: 40, notifications: [{ app: 'Messages', count: 12 }, { app: 'Messages', count: 3 }, { app: 'Mail', count: 5 }] }],
    })
    assert.equal(sent.status, 200)
    const [first] = await phoneDays()
    assert.equal(first.device, 'Galaxy S23')
    assert.equal(first.day, day)
    assert.equal(first.unlocks, 40)
    assert.deepEqual([...first.notifications].sort((a: { app: string }, b: { app: string }) => a.app.localeCompare(b.app)), [{ app: 'Mail', count: 5 }, { app: 'Messages', count: 15 }], 'two lines with one name are one line')

    await asPhone('POST', '/sync', { days: [{ day, apps: [], unlocks: 41, notifications: [] }] })
    const again = await phoneDays()
    assert.equal(again.length, 1, 'replaced, not added')
    assert.deepEqual([again[0].unlocks, again[0].notifications], [41, []])

    await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'YouTube', seconds: 90 }] }] })
    assert.equal((await phoneDays())[0].unlocks, 41, 'a sync with no counts keeps what was counted')

    assert.equal((await asPhone('POST', '/sync', { days: [{ day, apps: [], unlocks: -1 }] })).status, 400)
    assert.equal((await asPhone('POST', '/sync', { days: [{ day, apps: [], unlocks: 1, notifications: [{ app: 'X', count: 0 }] }] })).status, 400)
  })

  it('keeps the categories Android gives apps, lets the person file anything under their own, and can go back to automatic', async () => {
    const categories = async () => (await call('GET', '/integrations/screen-time/data')).body.categories
    const find = async (kind: string, name: string) => (await categories()).find((c: { kind: string; name: string }) => c.kind === kind && c.name === name)

    await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'Instagram', seconds: 60 }] }], categories: { Instagram: 'Social', Maps: 'Maps & travel' } })
    assert.deepEqual(await find('app', 'Instagram'), { kind: 'app', name: 'Instagram', mine: null, phone: 'Social' })

    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'app', name: 'Instagram', category: 'Time wasters' })).status, 204)
    assert.deepEqual(await find('app', 'Instagram'), { kind: 'app', name: 'Instagram', mine: 'Time wasters', phone: 'Social' })
    await asPhone('POST', '/sync', { days: [{ day, apps: [{ app: 'Instagram', seconds: 60 }] }], categories: { Instagram: 'Social' } })
    assert.equal((await find('app', 'Instagram')).mine, 'Time wasters', 'the phone does not overwrite what the person chose')

    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'site', name: 'youtube.com', category: 'Video' })).status, 204)
    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'site', name: 'youtube.com', category: null })).status, 204)
    assert.equal(await find('site', 'youtube.com'), undefined, 'automatic again, and nothing left to keep')
    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'app', name: 'Instagram', category: null })).status, 204)
    assert.deepEqual(await find('app', 'Instagram'), { kind: 'app', name: 'Instagram', mine: null, phone: 'Social' })

    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'thing', name: 'x', category: 'y' })).status, 400)
    assert.equal((await call('PUT', '/integrations/screen-time/category', { kind: 'app', name: 'x', category: '' })).status, 400)
    assert.equal((await asPhone('POST', '/sync', { days: [{ day, apps: [] }], categories: { X: 'a'.repeat(41) } })).status, 400)
    await call('PUT', '/integrations/screen-time/category', { kind: 'site', name: 'mine.example', category: 'Work' })

    const other = makeClient()
    assert.equal((await other('POST', '/auth/register', { email: 'category-other@example.com', name: 'Other', password: PASSWORD })).status, 201)
    assert.deepEqual((await other('GET', '/integrations/screen-time/data')).body.categories, [], "someone else's categories are not yours")
  })

  it("does not show one person's phone to another", async () => {
    const other = makeClient()
    assert.equal((await other('POST', '/auth/register', { email: 'phone-other@example.com', name: 'Other', password: PASSWORD })).status, 201)
    assert.deepEqual((await other('GET', '/integrations/phone')).body.devices, [])
    assert.deepEqual((await other('GET', '/integrations/screen-time/data')).body.usage, [])
    assert.deepEqual((await other('GET', '/integrations/screen-time/data')).body.phoneDays, [])
    assert.equal((await other('GET', '/integrations/screen-time/icon?kind=app&source=phone&name=YouTube')).status, 404)
    await other('DELETE', `/integrations/phone/${deviceId}`)
    assert.equal((await asPhone('GET', '/status')).status, 200, "someone else cannot unpair your phone")
  })

  it('is turned off by removing the phone, taking its numbers with it', async () => {
    const aw = await import('../src/models.js')
    await aw.ScreenTimeUsage.create({ userId: (await aw.PhoneDevice.findById(deviceId))?.userId, device: 'PC', source: 'activitywatch', day, app: 'chrome', seconds: 60 })
    assert.equal((await call('DELETE', `/integrations/phone/${deviceId}`)).status, 204)
    assert.equal((await asPhone('GET', '/status')).status, 401, 'its key stops working')
    const usage = (await call('GET', '/integrations/screen-time/data')).body.usage
    assert.deepEqual(usage.map((u: { app: string }) => u.app), ['chrome'], "the computer's numbers stay")
    assert.deepEqual((await call('GET', '/integrations/screen-time/data')).body.phoneDays, [], 'its unlocks and notifications go too')
    assert.deepEqual(
      (await call('GET', '/integrations/screen-time/data')).body.categories,
      [{ kind: 'site', name: 'mine.example', mine: 'Work', phone: null }],
      "what Android said goes with the phone; what the person chose stays",
    )
    assert.deepEqual((await call('GET', '/integrations/phone')).body.devices, [])
    const entry = (await call('GET', '/integrations')).body.find((i: { id: string }) => i.id === 'samsung-screen-time')
    assert.equal(entry.status, 'not_connected')
    await aw.ScreenTimeUsage.deleteMany({ app: 'chrome', device: 'PC' })
  })

  it('names a second phone with the same name differently, and lets a phone unpair itself', async () => {
    const pair = async (name: string) => (await phone('POST', '/phone/pair', { code: (await call('POST', '/integrations/phone/pair-code')).body.code, name })).body
    const a = await pair('Pixel')
    const b = await pair('Pixel')
    assert.equal(a.name, 'Pixel')
    assert.equal(b.name, 'Pixel 2')
    assert.equal((await asPhone('DELETE', '/me', undefined, a.token)).status, 204)
    assert.equal((await asPhone('GET', '/status', undefined, a.token)).status, 401)
    assert.equal((await asPhone('GET', '/status', undefined, b.token)).status, 200)
    assert.equal((await call('POST', '/integrations/samsung-screen-time/connect')).status, 400, 'pairing happens on the Screen Time page')
    assert.equal((await call('DELETE', '/integrations/samsung-screen-time/connection')).status, 204)
    assert.equal((await asPhone('GET', '/status', undefined, b.token)).status, 401)
  })

  it('slows down someone guessing codes', async () => {
    let last = 0
    for (let i = 0; i < 12 && last !== 429; i++) last = (await phone('POST', '/phone/pair', { code: `ZZZZ-${1000 + i}` })).status
    assert.equal(last, 429)
  })
})