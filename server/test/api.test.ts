import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import { connectDb, disconnectDb } from '../src/db.js'

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

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

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

  it('ignores query operator injection', async () => {
    const r = await call('GET', '/transactions?type[$ne]=income')
    assert.equal(r.status, 200)
    assert.equal(r.body.length, 3, 'object-valued filters are ignored, not executed')
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
