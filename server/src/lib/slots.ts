/**
 * Screen time by the quarter hour. A day has 96 quarters: 0 is 12:00 to 12:15 am, 4 is 1:00 to 1:15 am, and 95 is 11:45
 * pm to midnight. Each quarter keeps how many seconds of it an app or website was on screen (at most 900).
 */
export const SLOT_MS = 15 * 60 * 1000
export const SLOT_SECONDS = 900

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export type SlotRow = { day: string; name: string; slots: { q: number; seconds: number }[] }

/** Adds up time spans (start and end in milliseconds) by day, name and quarter hour, in the server's own time zone. */
export class SlotCounter {
  private rows = new Map<string, { day: string; name: string; ms: Map<number, number> }>()

  add(name: string, startMs: number, endMs: number) {
    if (!name || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return
    const stop = Math.min(endMs, startMs + 24 * 3_600_000) // one event never lasts longer than a day
    for (let at = startMs; at < stop; ) {
      const next = Math.min(stop, (Math.floor(at / SLOT_MS) + 1) * SLOT_MS)
      const local = new Date(at)
      const day = dayOf(local)
      const q = local.getHours() * 4 + Math.floor(local.getMinutes() / 15)
      const key = `${day}\u0000${name}`
      let row = this.rows.get(key)
      if (!row) this.rows.set(key, (row = { day, name, ms: new Map() }))
      row.ms.set(q, (row.ms.get(q) ?? 0) + (next - at))
      at = next
    }
  }

  /** What was counted, a row for each day and name, with only the quarters that have something. */
  result(): SlotRow[] {
    return [...this.rows.values()]
      .map((r) => ({
        day: r.day,
        name: r.name,
        slots: [...r.ms]
          .map(([q, ms]) => ({ q, seconds: Math.min(SLOT_SECONDS, Math.round(ms / 1000)) }))
          .filter((s) => s.seconds > 0)
          .sort((a, b) => a.q - b.q),
      }))
      .filter((r) => r.slots.length > 0)
  }
}