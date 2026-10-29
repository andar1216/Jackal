import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectRecurring, markId, merchantKey, type Charge, type Mark } from '../src/lib/recurring.js'

const TODAY = '2026-10-28'
const CARD = 'Chase · Card ••1111'
const charge = (note: string, amountCents: number, date: string, accountName = CARD): Charge => ({
  note,
  amountCents,
  date,
  accountName,
})
const find = (charges: Charge[], marks: [string, string, Mark][] = []) =>
  detectRecurring(charges, TODAY, new Map(marks.map(([account, note, mark]) => [markId(account, merchantKey(note)), mark])))

describe('recurring charges', () => {
  it('finds a monthly subscription even when the merchant text changes a little', () => {
    const { items } = find([
      charge('NETFLIX.COM 866-579-7172', 1549, '2026-08-05'),
      charge('Netflix.com 800-123-4567', 1549, '2026-09-05'),
      charge('NETFLIX.COM 866-579-7172', 1549, '2026-10-05'),
    ])
    assert.equal(items.length, 1)
    assert.equal(items[0].cadence, 'monthly')
    assert.equal(items[0].amountCents, 1549)
    assert.equal(items[0].monthlyCents, 1549)
    assert.equal(items[0].varies, false)
    assert.equal(items[0].marked, false)
    assert.equal(items[0].nextDate, '2026-11-05', 'the same day next month')
    assert.equal(items[0].active, true)
    assert.equal(items[0].count, 3)
  })

  it('counts a merchant charged once a month for 3 months in a row, even for different amounts', () => {
    const { items } = find([
      charge('AWS', 4210, '2026-08-02'),
      charge('AWS', 6875, '2026-09-02'),
      charge('AWS', 5530, '2026-10-02'),
    ])
    assert.equal(items.length, 1)
    const aws = items[0]
    assert.equal(aws.varies, true)
    assert.equal(aws.cadence, 'monthly')
    assert.equal(aws.monthlyCents, Math.round((4210 + 6875 + 5530) / 3), 'averages the months it was charged')
    assert.equal(aws.amountCents, aws.monthlyCents, 'shows the average when the price varies')
  })

  it('needs 3 months in a row with a single charge in each', () => {
    const { items, candidates } = find([
      // Only two months in a row.
      charge('Two Months', 1000, '2026-09-05'),
      charge('Two Months', 1000, '2026-10-05'),
      // Three months, but a second charge in one of them.
      charge('Printful', 2600, '2026-08-14'),
      charge('Printful', 1450, '2026-09-14'),
      charge('Printful', 900, '2026-09-28'),
      charge('Printful', 9100, '2026-10-12'),
      // Three months, but with a gap between them.
      charge('Gappy', 700, '2026-06-01'),
      charge('Gappy', 700, '2026-07-01'),
      charge('Gappy', 700, '2026-09-01'),
      charge('Gappy', 700, '2026-10-01'),
    ])
    assert.deepEqual(items, [])
    assert.deepEqual(candidates.map((c) => c.name).sort(), ['Gappy', 'Printful', 'Two Months'])
  })

  it('tolerates a small price increase and one skipped month', () => {
    const { items } = find([
      charge('Spotify', 1099, '2026-04-02'),
      charge('Spotify', 1099, '2026-05-02'),
      charge('Spotify', 1199, '2026-06-02'),
      charge('Spotify', 1199, '2026-08-02'), // July missing
      charge('Spotify', 1199, '2026-09-02'),
      charge('Spotify', 1199, '2026-10-02'),
    ])
    assert.equal(items.length, 1)
    assert.equal(items[0].amountCents, 1199, 'shows the latest price')
    assert.equal(items[0].varies, false)
  })

  it('ignores things that are not in two months in a row, and places visited constantly', () => {
    const { items, candidates } = find([
      charge('Amazon Mktp', 2399, '2026-08-03'), // Aug and Oct, not in a row
      charge('Amazon Mktp', 1200, '2026-10-01'),
      charge('Coffee Shop', 450, '2026-10-01'),
      charge('Coffee Shop', 450, '2026-10-02'),
      charge('Dentist', 12000, '2026-06-10'),
      charge('Dentist', 12000, '2026-10-20'),
      ...['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'].map((d, i) =>
        charge('Grocery Mart', 4000 + i * 700, d),
      ),
    ])
    assert.deepEqual(items, [])
    assert.deepEqual(
      candidates.map((c) => c.name).sort(),
      ['Amazon Mktp', 'Coffee Shop', 'Dentist', 'Grocery Mart'],
      'they stay available to mark by hand',
    )
  })

  it('lets a person mark a merchant as a subscription, or say it is not one', () => {
    const charges = [
      charge('Printful', 2600, '2026-06-14'),
      charge('Printful', 9100, '2026-10-12'), // not in a row, so not found by itself
      charge('Netflix', 1549, '2026-08-05'),
      charge('Netflix', 1549, '2026-09-05'),
      charge('Netflix', 1549, '2026-10-05'),
    ]
    assert.deepEqual(find(charges).items.map((i) => i.name), ['Netflix'])

    const marked = find(charges, [[CARD, 'Printful', 'subscription'], [CARD, 'Netflix', 'not']])
    assert.deepEqual(marked.items.map((i) => i.name), ['Printful'])
    assert.equal(marked.items[0].marked, true)
    assert.equal(marked.items[0].varies, true)
    assert.deepEqual(marked.ignored.map((i) => i.name), ['Netflix'], 'dismissed ones can be put back')
    assert.equal(marked.candidates.length, 0)
  })

  it('keeps accounts apart, and a yearly fee can be marked and is totaled per month', () => {
    const charges = [
      charge('Gym', 3000, '2026-08-01', 'Chase · Checking ••0000'),
      charge('Gym', 3000, '2026-09-01', 'Chase · Checking ••0000'),
      charge('Gym', 3000, '2026-10-01', 'Chase · Checking ••0000'),
      charge('Gym', 3000, '2026-04-01', 'Citi · Card ••7946'), // a single old charge on another account
      charge('Software', 12000, '2025-10-20', 'Citi · Card ••7946'),
      charge('Software', 12000, '2026-10-20', 'Citi · Card ••7946'),
    ]
    const auto = find(charges).items
    assert.deepEqual(auto.map((i) => `${i.name}@${i.account}`), ['Gym@Chase · Checking ••0000'], 'a yearly fee is not found by itself')

    const { items } = find(charges, [['Citi · Card ••7946', 'Software', 'subscription']])
    const software = items.find((f) => f.name === 'Software')
    assert.equal(software?.cadence, 'yearly')
    assert.equal(software?.monthlyCents, 1000)
    assert.equal(software?.marked, true)
  })

  it('marks one as ended when the charges stop', () => {
    const { items } = find([charge('Old App', 500, '2026-03-01'), charge('Old App', 500, '2026-04-01'), charge('Old App', 500, '2026-05-01')])
    assert.equal(items.length, 1)
    assert.equal(items[0].active, false)
  })
})
