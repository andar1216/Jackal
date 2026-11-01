import { startOfWeek, subWeeks } from 'date-fns'

// Crunch counts a week from Monday. Using the same start keeps these numbers equal to the ones on their site.
const MONDAY = { weekStartsOn: 1 } as const

/** Crunch's "average" looks at this many weeks, the current one included, and always divides by this number. */
export const AVERAGE_WEEKS = 12

export type WeekCount = { start: Date; count: number }

export type CheckInProgress = {
  thisWeek: number
  /** The person's weekly goal from Crunch, if they set one. */
  goal?: number
  /** Check-ins per week over the last 12 weeks. */
  average: number
  /** Most check-ins in any one week, ever. */
  best: number
  /** The last 12 weeks, oldest first. */
  weeks: WeekCount[]
}

export function checkInProgress(checkIns: { at: string }[], goal?: number | null, now = new Date()): CheckInProgress {
  const counts = new Map<number, number>()
  for (const c of checkIns) {
    const key = startOfWeek(new Date(c.at), MONDAY).getTime()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const weeks: WeekCount[] = []
  for (let i = AVERAGE_WEEKS - 1; i >= 0; i--) {
    const start = startOfWeek(subWeeks(now, i), MONDAY)
    weeks.push({ start, count: counts.get(start.getTime()) ?? 0 })
  }

  return {
    thisWeek: weeks[weeks.length - 1].count,
    goal: goal && goal > 0 ? goal : undefined,
    average: weeks.reduce((sum, w) => sum + w.count, 0) / AVERAGE_WEEKS,
    best: Math.max(0, ...counts.values()),
    weeks,
  }
}
