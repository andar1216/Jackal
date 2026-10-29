// Habits that mark themselves: every day counts as done unless the person unmarks it.
// A habit remembers the last day it was filled in (`autoThrough`), so a day the person
// unmarked stays unmarked, and only the days after that one get filled in later.

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 3700 // about ten years; keeps a typo like 0001-01-01 from filling thousands of days

const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`)
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * DAY_MS)

/** Every day from `from` to `to`, both included. Empty if `from` is after `to`. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = []
  for (let ms = toUtc(from); ms <= toUtc(to) && out.length < MAX_DAYS; ms += DAY_MS) out.push(fromUtc(ms))
  return out
}

/** The sorted, de-duplicated union of two lists of days. */
export const mergeDays = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort()

type AutoHabit = {
  startDate: string
  endDate?: string | null
  logs: string[]
  autoMark?: boolean | null
  autoThrough?: string | null
}

/** Fill in the days an auto-marking habit has not had yet, up to `today` (or its goal end date, if that comes first). Returns true if it changed anything. */
export function catchUp(doc: unknown, today: string): boolean {
  const habit = doc as AutoHabit // a habit document from the database
  if (!habit.autoMark) return false
  const upto = habit.endDate && habit.endDate < today ? habit.endDate : today
  const last = habit.autoThrough ?? addDays(habit.startDate, -1)
  if (last >= upto) return false
  habit.logs = mergeDays(habit.logs, daysFrom(addDays(last, 1), upto))
  habit.autoThrough = upto
  return true
}
