import { useEffect, useState } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { formatDuration, uid } from '../../lib/dates'
import type { TimeEntry } from '../../types'

const CATEGORIES = ['Work', 'Study', 'Exercise', 'Personal']

const entrySeconds = (e: TimeEntry, now: number) =>
  ((e.end ? parseISO(e.end).getTime() : now) - parseISO(e.start).getTime()) / 1000

export default function TimePage() {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [now, setNow] = useState(() => Date.now())

  const running = entries.find((e) => !e.end)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const start = () => {
    if (running) return
    const t = Date.now()
    setNow(t)
    setEntries((p) => [
      { id: uid(), label: label.trim() || 'Untitled', category, start: new Date(t).toISOString() },
      ...p,
    ])
    setLabel('')
  }

  const stop = () =>
    setEntries((p) => p.map((e) => (e.id === running?.id ? { ...e, end: new Date().toISOString() } : e)))

  const today = entries.filter((e) => isSameDay(parseISO(e.start), new Date(now)))
  const totalToday = today.reduce((s, e) => s + entrySeconds(e, now), 0)

  const byCategory = CATEGORIES.map((c) => ({
    category: c,
    seconds: today.filter((e) => e.category === c).reduce((s, e) => s + entrySeconds(e, now), 0),
  })).filter((c) => c.seconds > 0)

  return (
    <>
      <header className="page-header">
        <h1>Time</h1>
        <p>Start a timer and see where your day goes.</p>
      </header>

      <div className="grid cols-2">
        <section className="card">
          <h2>Timer</h2>
          <div className="timer-display">{running ? formatDuration(entrySeconds(running, now)) : '00:00:00'}</div>
          <p className="muted">{running ? `${running.label} · ${running.category}` : 'No timer running'}</p>
          <div className="form">
            <input
              placeholder="What are you working on?"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={!!running}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!!running}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {running ? (
              <button className="danger" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="primary" onClick={start}>
                Start
              </button>
            )}
          </div>

          <h2>Today by category</h2>
          {byCategory.length === 0 ? (
            <p className="empty">Nothing tracked yet.</p>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {byCategory.map((c) => (
                <div key={c.category}>
                  <div className="row between">
                    <span>{c.category}</span>
                    <span className="muted">{formatDuration(c.seconds)}</span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${(c.seconds / totalToday) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="row between">
            <h2>Today's entries</h2>
            <strong>{formatDuration(totalToday)}</strong>
          </div>
          {today.length === 0 ? (
            <p className="empty">No entries yet. Start the timer.</p>
          ) : (
            <ul className="list">
              {today.map((e) => (
                <li key={e.id}>
                  <span>
                    {e.label}
                    <br />
                    <span className="stat-label">
                      {e.category} · {format(parseISO(e.start), 'h:mm a')}
                      {e.end ? ` – ${format(parseISO(e.end), 'h:mm a')}` : ' – running'}
                    </span>
                  </span>
                  <span className="row">
                    <strong>{formatDuration(entrySeconds(e, now))}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
