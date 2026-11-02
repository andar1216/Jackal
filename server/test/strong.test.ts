import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { durationSeconds, parseStrong, parseTable, StrongFileError } from '../src/integrations/strong.js'

const HEADING = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE'

describe('Strong export', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    assert.deepEqual(parseTable('a,"b,c","say ""hi""","line\nbreak"\r\nd,e,f,g', ','), [
      ['a', 'b,c', 'say "hi"', 'line\nbreak'],
      ['d', 'e', 'f', 'g'],
    ])
  })

  it('groups the rows into workouts, exercises and sets, oldest first', () => {
    const file = [
      HEADING,
      '2026-10-30 18:00:00,Push Day,1h 5m,Bench Press (Barbell),1,60,8,0,0,,,',
      '2026-10-30 18:00:00,Push Day,1h 5m,Bench Press (Barbell),2,62.5,6,0,0,,,',
      '2026-10-30 18:00:00,Push Day,1h 5m,Overhead Press,1,40,10,0,0,,,',
      '2026-10-28 07:30:00,"Run, easy",45m,Treadmill,1,0,0,5000,1500,,,',
    ].join('\n')
    const [run, push] = parseStrong(file)

    assert.equal(run.type, 'Run, easy')
    assert.equal(run.date, '2026-10-28')
    assert.equal(run.durationMin, 45)
    assert.deepEqual(run.exercises, [{ name: 'Treadmill', sets: [{ seconds: 1500, distance: 5000 }] }])

    assert.equal(push.date, '2026-10-30')
    assert.equal(push.durationMin, 65)
    assert.deepEqual(push.exercises, [
      { name: 'Bench Press (Barbell)', sets: [{ weight: 60, reps: 8 }, { weight: 62.5, reps: 6 }] },
      { name: 'Overhead Press', sets: [{ weight: 40, reps: 10 }] },
    ])
    assert.equal(push.externalId, '2026-10-30 18:00:00|Push Day', 'the same workout always gets the same id')
  })

  it('copes with the semicolon version, units in the headings, seconds, comma decimals and a byte order mark', () => {
    const file = [
      '\uFEFF"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps"',
      '"2026-10-30 18:00:00";"Legs";"3600";"Squat";"1";"102,5";"5"',
      '"2026-10-30 18:00:00";"Legs";"3600";"Squat";"Rest Timer";"";""',
    ].join('\n')
    const [legs] = parseStrong(file)
    assert.equal(legs.durationMin, 60)
    assert.equal(legs.unit, 'kg')
    assert.deepEqual(legs.exercises, [{ name: 'Squat', sets: [{ weight: 102.5, reps: 5 }] }], 'the rest timer row is not a set')
  })

  it('reads durations written in different ways', () => {
    assert.equal(durationSeconds('1h 5m 30s'), 3930)
    assert.equal(durationSeconds('45m'), 2700)
    assert.equal(durationSeconds('2h'), 7200)
    assert.equal(durationSeconds('90'), 90)
    assert.equal(durationSeconds('90', 'Duration (min)'), 5400)
    assert.equal(durationSeconds(''), 0)
  })

  it('refuses a file that is not a Strong export', () => {
    assert.throws(() => parseStrong('name,amount\nbread,3'), StrongFileError)
    assert.throws(() => parseStrong(HEADING), StrongFileError)
  })
})
