import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addDays, catchUp, daysFrom, mergeDays } from '../src/lib/autoMark.js'

describe('auto-marking habits', () => {
  it('lists days across month ends, both ends included', () => {
    assert.deepEqual(daysFrom('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    assert.deepEqual(daysFrom('2026-10-05', '2026-10-05'), ['2026-10-05'])
    assert.deepEqual(daysFrom('2026-10-06', '2026-10-05'), [])
    assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  })

  it('merges days without repeats, sorted', () => {
    assert.deepEqual(mergeDays(['2026-10-03', '2026-10-01'], ['2026-10-02', '2026-10-03']), ['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('fills from the start date, then only the days since last time', () => {
    const habit = { startDate: '2026-10-01', logs: [] as string[], autoMark: true, autoThrough: undefined as string | undefined }
    assert.equal(catchUp(habit, '2026-10-03'), true)
    assert.deepEqual(habit.logs, ['2026-10-01', '2026-10-02', '2026-10-03'])
    assert.equal(catchUp(habit, '2026-10-03'), false, 'nothing new the same day')

    habit.logs = habit.logs.filter((d) => d !== '2026-10-02') // the person unmarked a day
    catchUp(habit, '2026-10-05')
    assert.deepEqual(habit.logs, ['2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05'], 'the unmarked day stays unmarked')
  })

  it('leaves a habit alone when auto-marking is off', () => {
    const habit = { startDate: '2026-10-01', logs: [] as string[], autoMark: false, autoThrough: undefined }
    assert.equal(catchUp(habit, '2026-10-05'), false)
    assert.deepEqual(habit.logs, [])
  })
})