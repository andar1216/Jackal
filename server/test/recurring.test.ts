import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectRecurring, type Charge } from '../src/lib/recurring.js'

const TODAY = '2026-10-28'
const charge = (note: string, amountCents: number, date: string, accountName = 'Chase · Card ••1111'): Charge => ({
  note,
  amountCents,
  date,
  accountName,
})

describe('recurring charges', () => {
  it('finds a monthly subscription even when the merchant text changes a little', () => {
    const found = detectRecurring(
      [
        charge('NETFLIX.COM 866-579-7172', 1549, '2026-08-05'),
        charge('Netflix.com 800-123-4567', 1549, '2026-09-05'),
        charge('NETFLIX.COM 866-579-7172', 1549, '2026-10-05'),
      ],
      TODAY,
    )
    assert.equal(found.length, 1)
    assert.equal(found[0].cadence, 'monthly')
    assert.equal(found[0].amountCents, 1549)
    assert.equal(found[0].monthlyCents, 1549)
    assert.equal(found[0].nextDate, '2026-11-05', 'the same day next month')
    assert.equal(found[0].active, true)
    assert.equal(found[0].count, 3)
  })

  it('tolerates a small price increase and one skipped month', () => {
    const found = detectRecurring(
      [
        charge('Spotify', 1099, '2026-04-02'),
        charge('Spotify', 1099, '2026-05-02'),
        charge('Spotify', 1199, '2026-06-02'),
        charge('Spotify', 1199, '2026-08-02'), // July missing
        charge('Spotify', 1199, '2026-09-02'),
        charge('Spotify', 1199, '2026-10-02'),
      ],
      TODAY,
    )
    assert.equal(found.length, 1)
    assert.equal(found[0].amountCents, 1199, 'shows the latest price')
  })

  it('ignores shopping: varying amounts, random dates, and a lone repeat', () => {
    const found = detectRecurring(
      [
        charge('Amazon Mktp', 2399, '2026-08-03'),
        charge('Amazon Mktp', 8750, '2026-08-19'),
        charge('Amazon Mktp', 1200, '2026-10-01'),
        charge('Coffee Shop', 450, '2026-10-01'),
        charge('Coffee Shop', 450, '2026-10-02'),
        charge('Dentist', 12000, '2026-06-10'),
        charge('Dentist', 12000, '2026-10-20'),
      ],
      TODAY,
    )
    assert.deepEqual(found, [])
  })

  it('keeps accounts apart and totals each cadence per month', () => {
    const found = detectRecurring(
      [
        charge('Gym', 3000, '2026-08-01', 'Chase · Checking ••0000'),
        charge('Gym', 3000, '2026-09-01', 'Chase · Checking ••0000'),
        charge('Gym', 3000, '2026-10-01', 'Chase · Checking ••0000'),
        charge('Gym', 3000, '2026-09-01', 'Citi · Card ••7946'), // only two on this account
        charge('Gym', 3000, '2026-10-01', 'Citi · Card ••7946'),
        charge('Software', 12000, '2025-10-20', 'Citi · Card ••7946'),
        charge('Software', 12000, '2026-10-20', 'Citi · Card ••7946'),
      ],
      TODAY,
    )
    assert.equal(found.length, 2)
    const gym = found.find((f) => f.name === 'Gym')
    assert.equal(gym?.account, 'Chase · Checking ••0000')
    const software = found.find((f) => f.name === 'Software')
    assert.equal(software?.cadence, 'yearly', 'two charges a year apart is enough for a yearly one')
    assert.equal(software?.monthlyCents, 1000)
  })

  it('marks one as ended when the charges stop', () => {
    const found = detectRecurring(
      [charge('Old App', 500, '2026-03-01'), charge('Old App', 500, '2026-04-01'), charge('Old App', 500, '2026-05-01')],
      TODAY,
    )
    assert.equal(found.length, 1)
    assert.equal(found[0].active, false)
  })
})
