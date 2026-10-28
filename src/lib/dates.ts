import { differenceInCalendarDays, format, parseISO } from 'date-fns'

/** YYYY-MM-DD for a local date (avoids UTC drift from toISOString). */
export const toDateKey = (d: Date) => format(d, 'yyyy-MM-dd')

export const todayKey = () => toDateKey(new Date())

/** Whole calendar days between a YYYY-MM-DD start date and today. */
export const daysSince = (startDate: string) =>
  Math.max(0, differenceInCalendarDays(new Date(), parseISO(startDate)))

export const formatDay = (dateKey: string) => format(parseISO(dateKey), 'MMM d, yyyy')

export const formatDuration = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export const uid = () => crypto.randomUUID()
