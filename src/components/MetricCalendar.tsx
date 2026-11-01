import { useState } from 'react'
import { addMonths, endOfMonth, format, getDay, parseISO, startOfMonth } from 'date-fns'
import { toDateKey, todayKey } from '../lib/dates'
import FilterMenu from './FilterMenu'

/** One thing a page tracks, as a number for each day. A day that has some is filled with its colour. */
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
  /** Starts switched off (it can be switched on in the filter). */
  off?: boolean
}

type Props = {
  metrics: CalendarMetric[]
  /** Pin the calendar to one month, for a page that already has its own month picker. Otherwise it has arrows. */
  month?: Date
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/**
 * A month of days. Every day that has something tracked is filled with that metric's colour, and metrics that share
 * a day are stacked as bands, the first one at the bottom (the same look as the habit calendar). The filter at the top
 * chooses which metrics show, and clicking a day lists what was tracked.
 */
export default function MetricCalendar({ metrics, month }: Props) {
  const [ownMonth, setOwnMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string | null>(null)
  // Until the person picks, every metric is shown except those that start off.
  const [picked, setPicked] = useState<string[] | null>(null)

  const shownMonth = month ?? ownMonth
  const chosen = new Set(picked ?? metrics.filter((m) => !m.off).map((m) => m.id))
  const on = metrics.filter((m) => chosen.has(m.id))

  const first = startOfMonth(shownMonth)
  const daysInMonth = endOfMonth(first).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(first.getFullYear(), first.getMonth(), i + 1)))
  const monthKeys = new Set(days)
  const today = todayKey()

  const has = (m: CalendarMetric, day: string) => (m.byDay[day] ?? 0) > 0
  const day = selected && monthKeys.has(selected) ? selected : null
  const dayMetrics = day ? on.filter((m) => has(m, day) || (m.entries?.[day]?.length ?? 0) > 0) : []

  return (
    <section className="card mcal">
      <div className="row between">
        <h2>Calendar</h2>
        <div className="row">
          <FilterMenu
            label="Calendar metrics"
            heading="Show on the calendar"
            options={metrics.map((m) => ({ id: m.id, label: m.label, color: m.color }))}
            selected={[...chosen]}
            onChange={setPicked}
          />
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

      <div className="mcal-grid" role="grid" aria-label={format(shownMonth, 'MMMM yyyy')}>
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="mcal-dow" aria-hidden>
            {d}
          </div>
        ))}
        {Array.from({ length: getDay(first) }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((d) => {
          const marks = on.filter((m) => has(m, d))
          const summary = marks.map((m) => `${m.label} ${m.format(m.byDay[d])}`).join(', ')
          return (
            <button
              key={d}
              type="button"
              className={`mcal-day ${marks.length > 0 ? 'on' : ''} ${d === today ? 'today' : ''} ${d === day ? 'selected' : ''}`}
              aria-pressed={d === day}
              aria-label={`${format(parseISO(d), 'MMMM d')}${summary ? `: ${summary}` : ''}`}
              title={summary || undefined}
              onClick={() => setSelected(d === day ? null : d)}
            >
              {marks.length > 0 && (
                <span className="layers" aria-hidden>
                  {marks.map((m) => (
                    <span key={m.id} className="layer" style={{ background: m.color }} />
                  ))}
                </span>
              )}
              <span className="mcal-num">{Number(d.slice(8))}</span>
            </button>
          )
        })}
      </div>

      {day ? (
        <div className="mcal-details">
          <strong>{format(parseISO(day), 'EEEE, MMMM d, yyyy')}</strong>
          {dayMetrics.length === 0 ? (
            <p className="empty">Nothing tracked this day.</p>
          ) : (
            <ul className="list">
              {dayMetrics.map((m) => (
                <li key={m.id}>
                  <span>
                    <span className="swatch" style={{ background: m.color, display: 'inline-block' }} aria-hidden /> {m.label}
                    {(m.entries?.[day] ?? []).map((line, i) => (
                      <span key={i} className="stat-label" style={{ display: 'block' }}>
                        {line}
                      </span>
                    ))}
                  </span>
                  <strong>{m.format(m.byDay[day] ?? 0)}</strong>
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
