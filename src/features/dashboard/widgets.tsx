import { useState } from 'react'
import Calendar from 'react-calendar'
import { isAfter, isBefore, parseISO, startOfDay } from 'date-fns'
import { formatDay, todayKey, toDateKey } from '../../lib/dates'
import type { Skill } from '../../types'
import { bestStreak, currentStreak, daysOnOff, weeklyStats } from './skillStats'

export type WidgetCtx = {
  skills: Skill[]
  selected: Skill | undefined
  status: 'loading' | 'ready' | 'error'
  select: (id: string) => void
  addSkill: (name: string) => void
  toggleDay: (id: string, dateKey: string) => void
  setAvgWeeks: (id: string, weeks: number) => void
}

const NoSkill = ({ ctx }: { ctx: WidgetCtx }) => (
  <p className="empty">
    {ctx.status === 'loading'
      ? 'Loading...'
      : ctx.status === 'error'
        ? "Couldn't load skills."
        : 'Add a skill in the Skills widget to see this.'}
  </p>
)

/* ---------------- Skills list ---------------- */

export function SkillsWidget({ ctx }: { ctx: WidgetCtx }) {
  const [name, setName] = useState('')
  const today = todayKey()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    ctx.addSkill(name.trim())
    setName('')
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <input
          placeholder="Add a skill you're working on"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Skill name"
        />
        <button className="primary" type="submit">
          Add
        </button>
      </form>

      {ctx.skills.length === 0 ? (
        <p className="empty">
          {ctx.status === 'loading'
            ? 'Loading...'
            : ctx.status === 'error'
              ? "Couldn't load skills."
              : 'No skills yet. Add one above.'}
        </p>
      ) : (
        <ul className="list">
          {ctx.skills.map((s) => {
            const done = s.logs.includes(today)
            const isSelected = ctx.selected?.id === s.id
            return (
              <li key={s.id} className={`skill-row ${isSelected ? 'selected' : ''}`}>
                <button
                  className="skill-name"
                  onClick={() => ctx.select(s.id)}
                  aria-pressed={isSelected}
                  title="Show this skill in the other widgets"
                >
                  <span className="swatch" style={{ background: s.color }} />
                  <span>
                    {s.name}
                    <span className="stat-label"> · since {formatDay(s.startDate)}</span>
                  </span>
                </button>
                <span className="row">
                  <span className="muted" title="Current streak">
                    🔥 {currentStreak(s)}
                  </span>
                  <button
                    className={done ? 'primary' : ''}
                    onClick={() => ctx.toggleDay(s.id, today)}
                    aria-pressed={done}
                  >
                    {done ? '✓ Done today' : 'Mark today'}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/* ---------------- Calendar ---------------- */

export function CalendarWidget({ ctx }: { ctx: WidgetCtx }) {
  const skill = ctx.selected
  if (!skill) return <NoSkill ctx={ctx} />

  const logs = new Set(skill.logs)
  const today = startOfDay(new Date())

  const tileClass = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null
    if (logs.has(toDateKey(date))) return 'day-on'
    if (!isBefore(date, today) || isBefore(date, parseISO(skill.startDate))) return null
    return 'day-off'
  }

  return (
    <div className="dash-cal" style={{ '--skill': skill.color } as React.CSSProperties}>
      <Calendar
        value={null}
        tileClassName={tileClass}
        tileDisabled={({ date, view }) => view === 'month' && isAfter(date, today)}
        onClickDay={(d) => ctx.toggleDay(skill.id, toDateKey(d))}
        // Month names only; year/decade views aren't useful for logging.
        minDetail="month"
      />
      <p className="stat-label" style={{ marginBottom: 0 }}>
        Click a day to mark it on or off.
      </p>
    </div>
  )
}

/* ---------------- Streak ---------------- */

export function StreakWidget({ ctx }: { ctx: WidgetCtx }) {
  const skill = ctx.selected
  if (!skill) return <NoSkill ctx={ctx} />

  const streak = currentStreak(skill)
  const best = bestStreak(skill)
  const loggedToday = skill.logs.includes(todayKey())

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="stat-value">
          🔥 {streak} <span className="stat-label">{streak === 1 ? 'day' : 'days'}</span>
        </div>
        <div className="stat-label">Current streak</div>
      </div>
      <div className="row between">
        <span className="muted">Best streak</span>
        <strong>{best} days</strong>
      </div>
      <p className="stat-label" style={{ margin: 0 }}>
        {loggedToday
          ? 'Today is logged. Nice work.'
          : streak > 0
            ? 'Log today to keep the streak alive.'
            : 'Log today to start a streak.'}
      </p>
    </div>
  )
}

/* ---------------- Days on / off ---------------- */

export function DaysOnOffWidget({ ctx }: { ctx: WidgetCtx }) {
  const skill = ctx.selected
  if (!skill) return <NoSkill ctx={ctx} />

  const { on, off } = daysOnOff(skill)
  const total = on + off
  const pct = total === 0 ? 0 : Math.round((on / total) * 100)

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="grid cols-2" style={{ gap: 8 }}>
        <div>
          <div className="stat-value good">{on}</div>
          <div className="stat-label">Days on</div>
        </div>
        <div>
          <div className="stat-value bad">{off}</div>
          <div className="stat-label">Days off</div>
        </div>
      </div>
      <div className="bar" aria-label={`${pct}% of days on`}>
        <span style={{ width: `${pct}%`, background: skill.color }} />
      </div>
      <p className="stat-label" style={{ margin: 0 }}>
        {pct}% of days since {formatDay(skill.startDate)}
      </p>
    </div>
  )
}

/* ---------------- Weekly average ---------------- */

export function AverageWidget({ ctx }: { ctx: WidgetCtx }) {
  const skill = ctx.selected
  if (!skill) return <NoSkill ctx={ctx} />

  const { counts, average } = weeklyStats(skill)

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="stat-value">
          {average.toFixed(1)} <span className="stat-label">days / week</span>
        </div>
        <div className="stat-label">
          Average over the last {skill.avgWeeks} {skill.avgWeeks === 1 ? 'week' : 'weeks'}
        </div>
      </div>

      <div className="week-bars" aria-label="Days on per week, oldest to newest">
        {counts.map((c, i) => (
          <div
            key={i}
            className="week-bar"
            title={`${c} day${c === 1 ? '' : 's'}`}
            style={{ height: `${(c / 7) * 100}%`, background: skill.color }}
          />
        ))}
      </div>

      <label className="row muted">
        Weeks to average
        <input
          type="number"
          min={1}
          max={52}
          value={skill.avgWeeks}
          onChange={(e) => ctx.setAvgWeeks(skill.id, parseInt(e.target.value, 10))}
          style={{ width: 72 }}
        />
      </label>
      <p className="stat-label" style={{ margin: 0 }}>
        Set per skill ({skill.name}).
      </p>
    </div>
  )
}
