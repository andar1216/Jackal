import { useEffect, useState } from 'react'
import { screenTimeApi } from '../../lib/api'
import type { ScreenTimeSlots } from '../../types'
import type { DeviceView } from './deviceViews'
import ItemIcon from './ItemIcon'
import { formatSeconds } from './screenTimeStats'
import { type KindChoice, QUARTERS, SLOT_SECONDS, hourLabel, levelFor, mergeRanges, quarterLabel, quarterTotals, rangeText, usedInQuarter, usedThatDay } from './timeline'

const REFRESH_MS = 60_000

/**
 * One day, hour by hour. Each hour is four squares (the first 15 minutes, 15 to 30, 30 to 45 and 45 to 60), and a square
 * is shaded by how much of its 15 minutes a screen was on: lightest for a little, darkest for all of it. An hour with all
 * four darkest was on screen the whole hour. Below it is each app and website with the times it was open.
 * Give it a key of the day, so choosing another day starts it fresh.
 */
export default function DayTimeline({ day, view }: { day: string; view: DeviceView }) {
  const [rows, setRows] = useState<ScreenTimeSlots[] | null>(null)
  const [kind, setKind] = useState<KindChoice>('all')
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      screenTimeApi.slots(day).then(
        (r) => !cancelled && setRows(r),
        () => !cancelled && setRows((old) => old ?? []),
      )
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [day])

  if (rows === null) return <p className="stat-label">Loading when things were on screen…</p>

  const inView = rows.filter((r) => view.includes(r.device))
  if (inView.length === 0) {
    return (
      <p className="stat-label">
        No times for this day. Times are saved from the moment ActivityWatch or the phone app has sent them, and the phone only
        keeps about the last week.
      </p>
    )
  }

  const bothKinds = inView.some((r) => r.kind === 'computer') && inView.some((r) => r.kind === 'phone')
  const choice: KindChoice = bothKinds ? kind : 'all'
  const totals = quarterTotals(inView, choice)
  const used = usedThatDay(inView, choice)
  const apps = used.filter((u) => u.type === 'app')
  const sites = used.filter((u) => u.type === 'site')
  const first = totals.findIndex((s) => s > 0)
  const detail = picked === null ? [] : usedInQuarter(inView, picked, choice)

  const hours = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => {
      const hour = from + i
      const cells = [0, 1, 2, 3].map((n) => hour * 4 + n)
      const full = cells.every((q) => levelFor(totals[q]) === 4)
      return (
        <div key={hour} className={`tl-hour ${full ? 'full' : ''}`}>
          <span className="tl-hour-label">{hourLabel(hour)}</span>
          {cells.map((q) => {
            const level = levelFor(totals[q])
            const text = `${quarterLabel(q)} – ${quarterLabel(q + 1)}${totals[q] > 0 ? `: ${formatSeconds(totals[q])}` : ''}`
            return (
              <button
                key={q}
                type="button"
                className={`tl-cell l${level} ${picked === q ? 'selected' : ''}`}
                aria-pressed={picked === q}
                aria-label={text}
                title={text}
                onClick={() => setPicked(picked === q ? null : q)}
              />
            )
          })}
        </div>
      )
    })

  const list = (title: string, items: typeof used) =>
    items.length > 0 && (
      <div className="tl-used">
        <h4>{title}</h4>
        <ul className="list">
          {items.map((u) => (
            <li key={u.key}>
              <span className="tl-name">
                <ItemIcon kind={u.type} name={u.name} label={u.name} source={u.kind === 'phone' ? 'phone' : undefined} />
                <span>
                  {u.name}
                  <span className="stat-label" style={{ display: 'block' }}>
                    {mergeRanges(u.quarters).map(rangeText).join(', ')}
                  </span>
                </span>
              </span>
              <strong>{formatSeconds(u.seconds)}</strong>
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <div className="tl">
      <div className="row between">
        <h4>When the screen was on</h4>
        {bothKinds && (
          <div className="segmented" role="group" aria-label="Show times for">
            {(['all', 'computer', 'phone'] as const).map((k) => (
              <button key={k} type="button" className={choice === k ? 'active' : ''} aria-pressed={choice === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k === 'computer' ? 'Computer' : 'Phone'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tl-halves" aria-label="Quarter hours of the day">
        <div>{hours(0, 12)}</div>
        <div>{hours(12, 24)}</div>
      </div>

      <div className="tl-legend stat-label" aria-hidden>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`tl-cell l${l} tl-swatch`} />
        ))}
        <span>More: all 15 minutes</span>
      </div>
      <p className="stat-label">
        Each square is 15 minutes ({SLOT_SECONDS / 60} minutes at most): the first 15 minutes of the hour, then 15 to 30, 30 to 45
        and 45 to 60. Four dark squares in a row means the whole hour.
        {first >= 0 && QUARTERS > 0 ? ` First on screen at ${quarterLabel(first)}.` : ''}
      </p>

      {picked !== null && (
        <div className="tl-picked">
          <strong>
            {quarterLabel(picked)} – {quarterLabel(picked + 1)}
          </strong>
          {detail.length === 0 ? (
            <p className="stat-label">Nothing was on screen.</p>
          ) : (
            <ul className="list">
              {detail.map((u) => (
                <li key={u.key}>
                  <span className="tl-name">
                    <ItemIcon kind={u.type} name={u.name} label={u.name} source={u.kind === 'phone' ? 'phone' : undefined} />
                    {u.name}
                  </span>
                  <strong>{formatSeconds(u.seconds)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {list('Apps', apps)}
      {list('Websites', sites)}
    </div>
  )
}