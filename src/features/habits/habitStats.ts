import { addDays, differenceInCalendarDays, parseISO, subDays } from 'date-fns'
import { toDateKey } from '../../lib/dates'
import type { Skill } from '../../types'

/** Consecutive days ending today (or yesterday, if today isn't logged yet). */
const MIN_DAYS_FOR_AVERAGE = 21 // three weeks

/** The weekly average only means something once a habit has been going for three weeks. */
export const hasEnoughForAverage = (skill: Skill): boolean =>
  differenceInCalendarDays(new Date(), parseISO(skill.startDate)) >= MIN_DAYS_FOR_AVERAGE

export function currentStreak(skill: Skill): number {
  const logs = new Set(skill.logs)
  let day = new Date()
  if (!logs.has(toDateKey(day))) day = subDays(day, 1)
  let streak = 0
  while (logs.has(toDateKey(day))) {
    streak++
    day = subDays(day, 1)
  }
  return streak
}

export function bestStreak(skill: Skill): number {
  const days = [...new Set(skill.logs)].sort()
  let best = 0
  let run = 0
  days.forEach((d, i) => {
    run = i > 0 && differenceInCalendarDays(parseISO(d), parseISO(days[i - 1])) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

/**
 * Days on = logged days. Days off = days since the start date that weren't logged.
 * Today isn't counted as "off" until it's over.
 */
export function daysOnOff(skill: Skill): { on: number; off: number } {
  const logs = new Set(skill.logs)
  const start = parseISO(skill.startDate)
  const daysBeforeToday = differenceInCalendarDays(new Date(), start)
  let on = 0
  let off = 0
  for (let i = 0; i <= daysBeforeToday; i++) {
    const logged = logs.has(toDateKey(addDays(start, i)))
    if (logged) on++
    else if (i < daysBeforeToday) off++
  }
  return { on, off }
}

/**
 * Per-week "days on" for the last N rolling 7-day weeks (oldest first),
 * and the average days per week over that window.
 * If the habit is newer than the window, only days since the start are used.
 */
export function weeklyStats(skill: Skill): { counts: number[]; average: number } {
  const logs = new Set(skill.logs)
  const today = new Date()
  const counts: number[] = []
  for (let week = skill.avgWeeks - 1; week >= 0; week--) {
    let count = 0
    for (let d = 0; d < 7; d++) {
      if (logs.has(toDateKey(subDays(today, week * 7 + d)))) count++
    }
    counts.push(count)
  }
  const windowDays = Math.min(
    skill.avgWeeks * 7,
    differenceInCalendarDays(today, parseISO(skill.startDate)) + 1,
  )
  const total = counts.reduce((a, b) => a + b, 0)
  const average = windowDays > 0 ? Math.min(7, total / (windowDays / 7)) : 0
  return { counts, average }
}
