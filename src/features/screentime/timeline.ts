import type { ScreenTimeSlots } from '../../types'

export const SLOT_SECONDS = 900
export const QUARTERS = 96

export type KindChoice = 'all' | 'computer' | 'phone'

/** How much of a quarter hour the screen was on, as a shade: 0 none, then up to a quarter, half, three quarters, and most or all of it. */
export const levelFor = (seconds: number): 0 | 1 | 2 | 3 | 4 =>
  seconds <= 0 ? 0 : seconds <= SLOT_SECONDS * 0.25 ? 1 : seconds <= SLOT_SECONDS * 0.5 ? 2 : seconds <= SLOT_SECONDS * 0.75 ? 3 : 4

/** "9 AM", "12 PM". */
export const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`

/** The time a quarter starts: 37 is "9:15 AM". 96 is the end of the day, "12:00 AM". */
export function quarterLabel(q: number) {
  const hour = Math.floor(q / 4) % 24
  const minutes = (q % 4) * 15
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

/** Quarters in a row become one stretch: [36, 37, 38, 40] is 9:00 to 9:45 and 10:00 to 10:15 (`to` is the first quarter after it). */
export function mergeRanges(quarters: number[]): { from: number; to: number }[] {
  const sorted = [...new Set(quarters)].sort((a, b) => a - b)
  const out: { from: number; to: number }[] = []
  for (const q of sorted) {
    const last = out[out.length - 1]
    if (last && last.to === q) last.to = q + 1
    else out.push({ from: q, to: q + 1 })
  }
  return out
}

export const rangeText = (r: { from: number; to: number }) => `${quarterLabel(r.from)} – ${quarterLabel(r.to)}`

const wanted = (row: ScreenTimeSlots, kind: KindChoice) => kind === 'all' || row.kind === kind

/**
 * Seconds the screen was on in each of the 96 quarters. Only apps count (a website is inside the browser, which is an
 * app). A device can't be on screen for more than the quarter, and two devices at once are not added up: the busier one counts.
 */
export function quarterTotals(rows: ScreenTimeSlots[], kind: KindChoice): number[] {
  const perDevice = new Map<string, number[]>()
  for (const row of rows) {
    if (row.type !== 'app' || !wanted(row, kind)) continue
    const key = `${row.kind}:${row.device}`
    const list = perDevice.get(key) ?? Array.from({ length: QUARTERS }, () => 0)
    for (const s of row.slots) if (s.q >= 0 && s.q < QUARTERS) list[s.q] = Math.min(SLOT_SECONDS, list[s.q] + s.seconds)
    perDevice.set(key, list)
  }
  return Array.from({ length: QUARTERS }, (_, q) => Math.max(0, ...[...perDevice.values()].map((l) => l[q])))
}

export type Used = { key: string; type: 'app' | 'site'; kind: 'computer' | 'phone'; name: string; seconds: number; quarters: number[] }

/** Each app and website used that day with the quarters it was in, most time first. The same name on two devices of one kind is one line. */
export function usedThatDay(rows: ScreenTimeSlots[], kind: KindChoice): Used[] {
  const by = new Map<string, Used & { per: Map<number, number> }>()
  for (const row of rows) {
    if (!wanted(row, kind)) continue
    const key = `${row.kind}:${row.type}:${row.name}`
    const item = by.get(key) ?? { key, type: row.type, kind: row.kind, name: row.name, seconds: 0, quarters: [], per: new Map() }
    for (const s of row.slots) item.per.set(s.q, Math.min(SLOT_SECONDS, (item.per.get(s.q) ?? 0) + s.seconds))
    by.set(key, item)
  }
  return [...by.values()]
    .map(({ per, ...item }) => ({ ...item, seconds: [...per.values()].reduce((a, b) => a + b, 0), quarters: [...per.keys()].sort((a, b) => a - b) }))
    .sort((a, b) => b.seconds - a.seconds)
}

/** Who was on screen in one quarter, most time first. */
export function usedInQuarter(rows: ScreenTimeSlots[], q: number, kind: KindChoice) {
  return rows
    .filter((r) => wanted(r, kind))
    .flatMap((r) => {
      const seconds = r.slots.find((s) => s.q === q)?.seconds ?? 0
      return seconds > 0 ? [{ key: `${r.kind}:${r.type}:${r.name}`, type: r.type, kind: r.kind, name: r.name, seconds }] : []
    })
    .sort((a, b) => b.seconds - a.seconds)
}