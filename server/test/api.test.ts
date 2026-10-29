import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import { config } from '../src/config.js'
import { connectDb, disconnectDb } from '../src/db.js'
import { PlaidError, setPlaidGateway, type PlaidGateway, type PlaidTx, type SyncPage } from '../src/integrations/plaidGateway.js'

let mongod: MongoMemoryServer
let server: Server
let base = ''

before(async () => {
  mongod = await MongoMemoryServer.create()
  await connectDb(mongod.getUri('jackal-test'))
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
    const set = res.headers.getSetCookie().find((c) => c.startsWith('jackal_sid='))
    if (set) cookie = set.startsWith('jackal_sid=;') ? '' : set.split(';')[0]
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set }
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

  it('labels a habit as performing or giving up', async () => {
    assert.equal((await call('GET', `/skills/${id}`)).body.kind, 'performing')
    const quit = await call('POST', '/skills', { name: 'No soda', startDate: '2026-10-01', kind: 'giving-up' })
    assert.equal(quit.body.kind, 'giving-up')
    assert.equal((await call('PATCH', `/skills/${quit.body.id}`, { kind: 'performing' })).body.kind, 'performing')
    assert.equal((await call('PATCH', `/skills/${quit.body.id}`, { kind: 'other' })).status, 400)
    await call('DELETE', `/skills/${quit.body.id}`)
  })

  it('hides and shows one habit\'s streak', async () => {
    assert.equal((await call('GET', `/skills/${id}`)).body.hideStreak, false)
    assert.equal((await call('PATCH', `/skills/${id}`, { hideStreak: true })).body.hideStreak, true)
    assert.equal((await call('PATCH', `/skills/${id}`, { hideStreak: 'no' })).status, 400)
    assert.equal((await call('PATCH', `/skills/${id}`, { hideStreak: false })).body.hideStreak, false)
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
  it('lists every planned integration as not connected and not yet available', async () => {
    const { status, body } = await call('GET', '/integrations')
    assert.equal(status, 200)
    assert.deepEqual(
      body.map((i: { id: string }) => i.id),
      ['google-calendar', 'plaid', 'myfitnesspal', 'crunch', 'samsung-screen-time', 'windows-screen-time'],
    )
    for (const item of body) {
      assert.equal(item.status, 'not_connected')
      assert.equal(item.available, false)
    }
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
