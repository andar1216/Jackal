import type { CalendarMetric } from '../components/MetricCalendar'

/** Builds a calendar metric from a list: each item says which day it is on and how much it adds. */
export function buildMetric<T>(
  base: Pick<CalendarMetric, 'id' | 'label' | 'color' | 'format' | 'off'>,
  items: T[],
  read: (item: T) => { day: string; amount: number; line?: string } | undefined,
): CalendarMetric {
  const byDay: Record<string, number> = {}
  const entries: Record<string, string[]> = {}
  for (const item of items) {
    const r = read(item)
    if (!r) continue
    byDay[r.day] = (byDay[r.day] ?? 0) + r.amount
    if (r.line) (entries[r.day] ??= []).push(r.line)
  }
  return { ...base, byDay, entries }
}
