import { useState } from 'react'
import Calendar from 'react-calendar'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { formatDay, toDateKey, uid } from '../../lib/dates'
import ConnectorsButton from '../connections/ConnectorsButton'
import type { CalendarEvent, Integration, Tracker } from '../../types'
import Board, { Panel } from '../../components/Board'

const isCalendarConnector = (i: Integration) => i.category === 'calendar'

type Props = {
  trackers: Tracker[]
  events: CalendarEvent[]
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>
}

export default function CalendarPage({ trackers, events, setEvents }: Props) {
  const [selected, setSelected] = useState(new Date())
  const [title, setTitle] = useState('')

  const key = toDateKey(selected)
  const dayEvents = events.filter((e) => e.date === key)
  const dayTrackers = trackers.filter((t) => t.startDate === key)
  // Trackers that were already running on the selected day
  const activeTrackers = trackers.filter((t) => t.startDate < key)

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setEvents((p) => [...p, { id: uid(), title: title.trim(), date: key }])
    setTitle('')
  }

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Calendar</h1>
          <p>Events and tracker start dates in one place.</p>
        </div>
        <ConnectorsButton filter={isCalendarConnector} title="Calendar connectors" />
      </header>

      <Board page="calendar">
        <Panel id="calendar" title="Calendar" size="half">
          <section>
            <Calendar
              value={selected}
              onChange={(v) => v instanceof Date && setSelected(v)}
              tileContent={({ date, view }) => {
                if (view !== 'month') return null
                const k = toDateKey(date)
                const evs = events.filter((e) => e.date === k)
                const trs = trackers.filter((t) => t.startDate === k)
                if (evs.length + trs.length === 0) return null
                return (
                  <div className="dots">
                    {trs.map((t) => (
                      <span key={t.id} className="dot" style={{ background: t.color }} />
                    ))}
                    {evs.map((e) => (
                      <span key={e.id} className="dot" />
                    ))}
                  </div>
                )
              }}
            />
          </section>
        </Panel>

        <Panel id="events" title="Events" size="half">
          <section className="card">
            <h2>{formatDay(key)}</h2>
            <form className="form" onSubmit={add}>
              <input
                placeholder="Add an event"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Event title"
              />
              <button className="primary" type="submit">
                Add
              </button>
            </form>

            {dayEvents.length === 0 && dayTrackers.length === 0 && activeTrackers.length === 0 ? (
              <p className="empty">Nothing on this day.</p>
            ) : (
              <ul className="list">
                {dayEvents.map((e) => (
                  <li key={e.id}>
                    <span>{e.title}</span>
                  </li>
                ))}
                {dayTrackers.map((t) => (
                  <li key={t.id}>
                    <span style={{ color: t.color }}>Started: {t.name}</span>
                    <span className="muted">Day 0</span>
                  </li>
                ))}
                {activeTrackers.map((t) => (
                  <li key={t.id}>
                    <span>{t.name}</span>
                    <span className="muted">Day {differenceInCalendarDays(selected, parseISO(t.startDate))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>
      </Board>
    </>
  )
}
