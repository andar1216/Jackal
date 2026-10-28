import { useState } from 'react'
import Calendar from 'react-calendar'
import { daysSince, formatDay, todayKey, toDateKey, uid } from '../../lib/dates'
import type { Tracker } from '../../types'

const COLORS = ['#4f46e5', '#db2777', '#0891b2', '#16a34a', '#d97706', '#9333ea']
const MILESTONES = [7, 30, 60, 100, 180, 365, 730, 1000]

type Props = {
  trackers: Tracker[]
  setTrackers: React.Dispatch<React.SetStateAction<Tracker[]>>
}

export default function StreaksPage({ trackers, setTrackers }: Props) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(new Date())

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setTrackers((prev) => [
      ...prev,
      {
        id: uid(),
        name: name.trim(),
        startDate: toDateKey(startDate),
        color: COLORS[prev.length % COLORS.length],
      },
    ])
    setName('')
  }

  const reset = (id: string) =>
    setTrackers((prev) => prev.map((t) => (t.id === id ? { ...t, startDate: todayKey() } : t)))

  const startsOn = (d: Date) => trackers.filter((t) => t.startDate === toDateKey(d))

  return (
    <>
      <header className="page-header">
        <h1>Streaks</h1>
        <p>Track how many days you've kept something going.</p>
      </header>

      <div className="grid cols-2">
        <section className="card">
          <h2>Start something new</h2>
          <form className="form" onSubmit={add}>
            <input
              placeholder="e.g. No sugar, Daily reading"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Tracker name"
            />
            <button className="primary" type="submit">
              Add
            </button>
          </form>
          <p className="muted">Pick the start date:</p>
          <Calendar
            value={startDate}
            onChange={(v) => v instanceof Date && setStartDate(v)}
            tileContent={({ date, view }) =>
              view === 'month' && startsOn(date).length > 0 ? (
                <div className="dots">
                  {startsOn(date).map((t) => (
                    <span key={t.id} className="dot" style={{ background: t.color }} />
                  ))}
                </div>
              ) : null
            }
          />
        </section>

        <section className="card">
          <h2>Your trackers</h2>
          {trackers.length === 0 ? (
            <p className="empty">Nothing yet. Add your first tracker.</p>
          ) : (
            <ul className="list">
              {trackers.map((t) => {
                const days = daysSince(t.startDate)
                const next = MILESTONES.find((m) => m > days)
                const prev = [...MILESTONES].reverse().find((m) => m <= days) ?? 0
                const pct = next ? ((days - prev) / (next - prev)) * 100 : 100
                return (
                  <li key={t.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="row between">
                      <strong style={{ color: t.color }}>{t.name}</strong>
                      <span>
                        <button className="link" onClick={() => reset(t.id)}>
                          Reset
                        </button>
                      </span>
                    </div>
                    <div className="row between">
                      <span className="stat-value">
                        {days} <span className="stat-label">{days === 1 ? 'day' : 'days'}</span>
                      </span>
                      <span className="muted">since {formatDay(t.startDate)}</span>
                    </div>
                    <div className="bar" title={next ? `Next milestone: ${next} days` : 'All milestones reached'}>
                      <span style={{ width: `${pct}%`, background: t.color }} />
                    </div>
                    <span className="stat-label">
                      {next ? `${next - days} days to ${next}-day milestone` : 'All milestones reached'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
