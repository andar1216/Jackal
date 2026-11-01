import { useState } from 'react'
import { addMonths, endOfMonth, format, getDay, parseISO, startOfMonth } from 'date-fns'
import { toDateKey, todayKey } from '../lib/dates'

/** One thing a page tracks, as a number for each day. A dot of its colour marks the days that have some. */
export type CalendarMetric = {
  id: string
  label: string
  color: string
  /** YYYY-MM-DD to an amount. Days with nothing are left out (or 0). */
  byDay: Record<string, number>
  /** How an amount reads, for example "$12.50" or "430 kcal". */
  format: (amount: number) => string
  /** What made up a day, for the list under the calendar. */
  entries?: Record<string, string[]>
  /** Starts switched off (it can be switched on with its chip). */
  off?: boolean
}

type Props = {
  metrics: CalendarMetric[]
  /** Pin the calendar to one month, for a page that already has its own month picker. Otherwise it has arrows. */
  month?: Date
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** A month of days, each marked with what the page tracked that day. Click a day to see the details. */
export default function MetricCalendar({ metrics, month }: Props) {
  const [ownMonth, setOwnMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(null)
  // Metrics the person has flipped from their starting state.
  const [flipped, setFlipped] = useState<Set<string>>(new Set())

  const shownMonth = month ?? ownMonth
  const isOn = (m: CalendarMetric) => (m.off ? flipped.has(m.id) : !flipped.has(m.id))
  const on = metrics.filter(isOn)
  const flip = (id: string) =>
    setFlipped((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const first = startOfMonth(shownMonth)
  const daysInMonth = endOfMonth(first).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(first.getFullYear(), first.getMonth(), i + 1)))
  const monthKeys = new Set(days)
  const today = todayKey()

  // The busiest day sets the strongest colour, so a big day stands out from a small one.
  const peak = (m: CalendarMetric) => Math.max(0, ...days.map((d) => m.byDay[d] ?? 0))
  const peaks = new Map(on.map((m) => [m.id, peak(m)]))

  const has = (m: CalendarMetric, day: string) => (m.byDay[day] ?? 0) > 0
  const chosen = selected && monthKeys.has(selected) ? selected : null
  const chosenMetrics = chosen ? on.filter((m) => has(m, chosen) || (m.entries?.[chosen]?.length ?? 0) > 0) : []

  return (
    <section className="card mcal">
      <div className="row between">
        <h2>Calendar</h2>
        <div className="row">
          {!month && (
            <button aria-label="Previous month" onClick={() => setOwnMonth((m) => addMonths(m, -1))}>
              ‹
            </button>
          )}
          <strong>{format(shownMonth, 'MMMM yyyy')}</strong>
          {!month && (
            <button aria-label="Next month" onClick={() => setOwnMonth((m) => addMonths(m, 1))}>
              ›
            </button>
          )}
        </div>
      </div>

      <div className="mcal-chips">
        {metrics.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mcal-chip ${isOn(m) ? '' : 'off'}`}
            aria-pressed={isOn(m)}
            onClick={() => flip(m.id)}
          >
            <span className="mcal-dot" style={{ background: m.color }} aria-hidden />
            {m.label}
          </button>
        ))}
      </div>

      <div className="mcal-grid" role="grid" aria-label={format(shownMonth, 'MMMM yyyy')}>
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="mcal-dow" aria-hidden>
            {d}
          </div>
        ))}
        {Array.from({ length: getDay(first) }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((day) => {
          const marks = on.filter((m) => has(m, day))
          return (
            <button
              key={day}
              type="button"
              className={`mcal-day ${day === today ? 'today' : ''} ${day === chosen ? 'selected' : ''}`}
              aria-pressed={day === chosen}
              aria-label={`${format(parseISO(day), 'MMMM d')}${marks.length ? `: ${marks.map((m) => `${m.label} ${m.format(m.byDay[day])}`).join(', ')}` : ''}`}
              onClick={() => setSelected(day === chosen ? null : day)}
            >
              <span className="mcal-num">{Number(day.slice(8))}</span>
              <span className="mcal-dots">
                {marks.map((m) => (
                  <span
                    key={m.id}
                    className="mcal-dot"
                    style={{ background: m.color, opacity: 0.35 + 0.65 * ((m.byDay[day] ?? 0) / (peaks.get(m.id) || 1)) }}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {chosen ? (
        <div className="mcal-details">
          <strong>{format(parseISO(chosen), 'EEEE, MMMM d, yyyy')}</strong>
          {chosenMetrics.length === 0 ? (
            <p className="empty">Nothing tracked this day.</p>
          ) : (
            <ul className="list">
              {chosenMetrics.map((m) => (
                <li key={m.id}>
                  <span>
                    <span className="mcal-dot" style={{ background: m.color }} aria-hidden /> {m.label}
                    {(m.entries?.[chosen] ?? []).map((line, i) => (
                      <span key={i} className="stat-label" style={{ display: 'block' }}>
                        {line}
                      </span>
                    ))}
                  </span>
                  <strong>{m.format(m.byDay[chosen] ?? 0)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="stat-label">Click a day to see what was tracked.</p>
      )}
    </section>
  )
}
