import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CrunchError,
  parseBilling,
  parseBillingDate,
  parseCheckIns,
  parseClassTime,
  parseClasses,
  parseProfile,
  toCents,
} from '../src/integrations/crunchGateway.js'

// All sample data here is made up. It only copies the shape of what members.crunch.com returns.

describe('reading what Crunch sends', () => {
  it('finds the member id and weekly goal in the profile page', () => {
    const html = '<div data-member-id="42" data-workout-goal="4"></div><a href="/members/42/agreement">View</a>'
    assert.deepEqual(parseProfile(html), { memberId: '42', workoutGoal: 4 })
    assert.deepEqual(parseProfile('<a href="/members/7/agreement">'), { memberId: '7', workoutGoal: undefined })
    assert.equal(parseProfile('<form id="new_member"></form>'), undefined)
  })

  it('reads check-ins and skips ones without a usable time', () => {
    const rows = parseCheckIns([
      { id: 1, location: 'Club One', checkin_time: '2026-10-30T22:00:00.000Z', mms_checkin_id: 'abc' },
      { id: 2, location: 'Club One', checkin_time: 'garbage', mms_checkin_id: 'def' },
    ])
    assert.deepEqual(rows, [{ id: 'abc', at: '2026-10-30T22:00', club: 'Club One' }])
  })

  it('reads class history, turning 12-hour times into club-local ones', () => {
    const rows = parseClasses([
      { program_name: 'Yoga', occurrence_start_time: '2026-10-05 06:30pm', club: { name: 'Club One' }, status: 'attended', fee_amount: null },
      { program_name: 'Spin', occurrence_start_time: '2026-10-06 12:15am', club: null, status: 'no-show', fee_amount: '5.00' },
    ])
    assert.deepEqual(rows[0], { program: 'Yoga', startsAt: '2026-10-05T18:30', club: 'Club One', status: 'attended', feeCents: undefined })
    assert.equal(rows[1].startsAt, '2026-10-06T00:15')
    assert.equal(rows[1].feeCents, 500)
  })

  it('reads billing history, with payments and credits as negative amounts', () => {
    const { payments, balanceCents } = parseBilling({
      invoices: [
        { mms_club_id: '1', amount: '19.99', service_name: 'Dues', purchase_date: '10/01/26' },
        { mms_club_id: '1', amount: '-19.99', service_name: 'Pay', purchase_date: '10/01/26' },
        { mms_club_id: '1', amount: '1.00', service_name: 'Odd', purchase_date: 'not a date' },
      ],
      total_balance: '0.00',
    })
    assert.deepEqual(
      payments.map((p) => [p.service, p.amountCents, p.date]),
      [
        ['Dues', 1999, '2026-10-01'],
        ['Pay', -1999, '2026-10-01'],
      ],
    )
    assert.equal(balanceCents, 0)
  })

  it('parses single dates and money tolerantly', () => {
    assert.equal(parseBillingDate('1/5/2026'), '2026-01-05')
    assert.equal(parseClassTime('2026-10-05 12:00pm'), '2026-10-05T12:00')
    assert.equal(toCents('$1,234.50'), 123450)
    assert.equal(toCents(null), undefined)
  })

  it('refuses a shape it does not know instead of importing nothing silently', () => {
    assert.throws(() => parseCheckIns({ oops: true }), CrunchError)
    assert.throws(() => parseClasses('nope'), CrunchError)
    assert.throws(() => parseBilling({}), CrunchError)
  })
})
