import { useState } from 'react'
import Calendar from 'react-calendar'
import { differenceInCalendarDays, isAfter, isBefore, parseISO, startOfDay } from 'date-fns'
import { formatDay, todayKey, toDateKey } from '../../lib/dates'
import MenuButton from '../../components/MenuButton'
import type { Skill } from '../../types'
import { bestStreak, currentStreak, daysOnOff, weeklyStats } from './habitStats'

export type HabitFields = { name: string; color: string; startDate: string; endDate: string | null; autoMark: boolean }

export type HabitChanges = Partial<HabitFields> & { hideStreak?: boolean }

/** "goal Dec 31 · 12 days left", or that the goal date has passed. */
function goalText(habit: Skill, today: string): string | null {
  if (!habit.endDate) return null
  const left = differenceInCalendarDays(parseISO(habit.endDate), parseISO(today))
  if (left < 0) return `goal date passed (${formatDay(habit.endDate)})`
  if (left === 0) return 'goal ends today'
  return `goal ${formatDay(habit.endDate)} · ${left} ${left === 1 ? 'day' : 'days'} left`
}

export type WidgetCtx = {
  skills: Skill[] // habits in use
  archived: Skill[]
  selected: Skill | undefined
  status: 'loading' | 'ready' | 'error'
  /** Streaks are hidden for every habit. */
  hideAllStreaks: boolean
  /** The colour the next new habit starts with. */
  nextColor: string
  select: (id: string) => void
  addHabit: (fields: HabitFields) => void
  updateHabit: (habit: Skill, changes: HabitChanges) => void
  setArchived: (habit: Skill, archived: boolean) => void
  removeHabit: (habit: Skill) => void
  toggleDay: (id: string, dateKey: string) => void
  setAvgWeeks: (id: string, weeks: number) => void
}

const streakShown = (ctx: WidgetCtx, habit: Skill) => !ctx.hideAllStreaks && !habit.hideStreak

const NoHabit = ({ ctx }: { ctx: WidgetCtx }) => (
  <p className="empty">
    {ctx.status === 'loading'
      ? 'Loading...'
      : ctx.status === 'error'
        ? "Couldn't load habits."
        : 'Add a habit in the Habits widget to see this.'}
  </p>
)

/* ---------------- Habits list ---------------- */

/** Change a habit's name, start date, colour, and whether it marks itself every day. */
function HabitEditor({ habit, ctx, onDone }: { habit: Skill; ctx: WidgetCtx; onDone: () => void }) {
  const [name, setName] = useState(habit.name)
  const [startDate, setStartDate] = useState(habit.startDate)
  const [endDate, setEndDate] = useState(habit.endDate ?? '') // '' = no goal date
  const [color, setColor] = useState(habit.color)
  const [autoMark, setAutoMark] = useState(!!habit.autoMark)

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !startDate) return
    const changes: Partial<HabitFields> = {}
    if (name.trim() !== habit.name) changes.name = name.trim()
    if (startDate !== habit.startDate) changes.startDate = startDate
    if (endDate !== (habit.endDate ?? '')) changes.endDate = endDate || null
    if (color !== habit.color) changes.color = color
    if (autoMark !== !!habit.autoMark) changes.autoMark = autoMark
    if (Object.keys(changes).length > 0) ctx.updateHabit(habit, changes)
    onDone()
  }

  return (
    <form className="form habit-edit" onSubmit={save} style={{ marginBottom: 0, width: '100%' }}>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Habit name" autoFocus />
      <label className="row" title="The day this habit starts counting from">
        <span className="stat-label">Starts</span>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" required />
      </label>
      <label className="row" title="Optional: the day you want to reach by. Clear it to have no goal date.">
        <span className="stat-label">Goal end</span>
        <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Goal end date" />
      </label>
      <label className="row">
        <span className="stat-label">Color</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
      </label>
      <label className="row" title="Count every day as done, from the start date on. Unmark a day to take it back.">
        <input type="checkbox" checked={autoMark} onChange={(e) => setAutoMark(e.target.checked)} />
        <span>Mark every day automatically</span>
      </label>
      <button className="primary" type="submit">
        Save
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  )
}

export function HabitsWidget({ ctx }: { ctx: WidgetCtx }) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(todayKey())
  const [endDate, setEndDate] = useState('')
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const [autoMark, setAutoMark] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const today = todayKey()

  const remove = (h: Skill) => {
    if (window.confirm(`Delete "${h.name}" for good? Its whole history is lost and this can't be undone.`)) ctx.removeHabit(h)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !startDate) return
    ctx.addHabit({ name: name.trim(), color: pickedColor ?? ctx.nextColor, startDate, endDate: endDate || null, autoMark })
    setName('')
    setStartDate(todayKey())
    setEndDate('')
    setPickedColor(null)
    setAutoMark(false)
  }

  return (
    <>
      <form className="form habit-edit" onSubmit={submit}>
        <input
          placeholder="Add a habit you're working on"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Habit name"
        />
        <label className="row" title="The day this habit starts counting from">
          <span className="stat-label">Starts</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" required />
        </label>
        <label className="row" title="Optional: the day you want to reach by">
          <span className="stat-label">Goal end</span>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} aria-label="Goal end date" />
        </label>
        <label className="row">
          <span className="stat-label">Color</span>
          <input type="color" value={pickedColor ?? ctx.nextColor} onChange={(e) => setPickedColor(e.target.value)} aria-label="Color" />
        </label>
        <label className="row" title="Count every day as done, from the start date on. Unmark a day to take it back.">
          <input type="checkbox" checked={autoMark} onChange={(e) => setAutoMark(e.target.checked)} />
          <span>Mark every day</span>
        </label>
        <button className="primary" type="submit">
          Add
        </button>
      </form>

      {ctx.skills.length === 0 ? (
        <p className="empty">
          {ctx.status === 'loading'
            ? 'Loading...'
            : ctx.status === 'error'
              ? "Couldn't load habits."
              : 'No habits yet. Add one above.'}
        </p>
      ) : (
        <ul className="list">
          {ctx.skills.map((s) => {
            const done = s.logs.includes(today)
            const isSelected = ctx.selected?.id === s.id
            return (
              <li key={s.id} className={`skill-row ${isSelected ? 'selected' : ''}`}>
                {editingId === s.id ? (
                  <HabitEditor habit={s} ctx={ctx} onDone={() => setEditingId(null)} />
                ) : (
                  <>
                    <button
                      className="skill-name"
                      onClick={() => ctx.select(s.id)}
                      aria-pressed={isSelected}
                      title="Show this habit in the other widgets"
                    >
                      <span className="swatch" style={{ background: s.color }} />
                      <span>
                        {s.name}
                        {streakShown(ctx, s) && <span className="stat-label"> · since {formatDay(s.startDate)}</span>}
                        {goalText(s, today) && <span className="stat-label"> · {goalText(s, today)}</span>}
                        {s.autoMark && (
                          <span className="pill" style={{ marginLeft: 8 }} title="Marked every day automatically">
                            auto
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="row">
                      {streakShown(ctx, s) && (
                        <span className="muted" title="Current streak">
                          🔥 {currentStreak(s)}
                        </span>
                      )}
                      <button
                        className={done ? 'primary' : ''}
                        onClick={() => ctx.toggleDay(s.id, today)}
                        aria-pressed={done}
                      >
                        {done ? '✓ Done today' : 'Mark today'}
                      </button>
                      <MenuButton
                        label={`More for ${s.name}`}
                        items={[
                          { label: 'Edit', onSelect: () => setEditingId(s.id) },
                          {
                            label: s.hideStreak ? 'Show streak' : 'Hide streak',
                            onSelect: () => ctx.updateHabit(s, { hideStreak: !s.hideStreak }),
                          },
                          { label: 'Archive', onSelect: () => ctx.setArchived(s, true) },
                        ]}
                      />
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {ctx.archived.length > 0 && (
        <>
          <button className="link" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            {showArchived ? 'Hide' : 'Show'} archived ({ctx.archived.length})
          </button>
          {showArchived && (
            <ul className="list">
              {ctx.archived.map((h) => (
                <li key={h.id}>
                  <span>
                    <span className="swatch" style={{ background: h.color }} /> {h.name}
                    <span className="stat-label">
                      {' '}
                      · {h.logs.length} {h.logs.length === 1 ? 'day' : 'days'} logged
                    </span>
                  </span>
                  <span className="row">
                    <button className="link" onClick={() => ctx.setArchived(h, false)}>
                      Restore
                    </button>
                    <button className="link" onClick={() => remove(h)} style={{ color: 'var(--bad)' }}>
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

/* ---------------- Calendar ---------------- */

export function CalendarWidget({ ctx }: { ctx: WidgetCtx }) {
  // Habits that share a day are stacked as bands of colour, oldest habit at the bottom.
  const [layered, setLayered] = useState(true)
  const skill = ctx.selected
  if (!skill) return <NoHabit ctx={ctx} />

  const oldestFirst = [...ctx.skills].sort((a, b) => a.startDate.localeCompare(b.startDate)) // stable: ties keep list order
  const shown = layered ? oldestFirst : [skill]
  const today = startOfDay(new Date())

  const doneOn = (date: Date) => shown.filter((h) => h.logs.includes(toDateKey(date)))

  const tileClass = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null
    const done = doneOn(date)
    if (done.length > 0) return layered ? 'day-layered' : 'day-on'
    if (!isBefore(date, today) || isBefore(date, parseISO(skill.startDate))) return null
    return 'day-off'
  }

  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (!layered || view !== 'month') return null
    const done = doneOn(date)
    if (done.length === 0) return null
    return (
      <span className="layers" title={done.map((h) => h.name).join(', ')} aria-hidden>
        {done.map((h) => (
          <span key={h.id} className="layer" style={{ background: h.color }} />
        ))}
      </span>
    )
  }

  return (
    <div className="dash-cal" style={{ '--skill': skill.color } as React.CSSProperties}>
      <Calendar
        value={null}
        tileClassName={tileClass}
        tileContent={tileContent}
        tileDisabled={({ date, view }) => view === 'month' && isAfter(date, today)}
        onClickDay={(d) => ctx.toggleDay(skill.id, toDateKey(d))}
        // Month names only; year/decade views aren't useful for logging.
        minDetail="month"
      />
      <label className="row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={layered} onChange={(e) => setLayered(e.target.checked)} />
        <span>Layer all habits (days they share stack up, oldest habit at the bottom)</span>
      </label>
      {layered && ctx.skills.length > 1 && (
        <div className="row" style={{ gap: 12 }}>
          {oldestFirst.map((h) => (
            <span key={h.id} className="stat-label">
              <span className="swatch" style={{ background: h.color, display: 'inline-block' }} /> {h.name}
            </span>
          ))}
        </div>
      )}
      <p className="stat-label" style={{ marginBottom: 0 }}>
        Click a day to mark it on or off{layered ? ` for ${skill.name}` : ''}.
      </p>
    </div>
  )
}
/* ---------------- Streak ---------------- */

export function StreakWidget({ ctx }: { ctx: WidgetCtx }) {
  const skill = ctx.selected
  if (!skill) return <NoHabit ctx={ctx} />

  if (!streakShown(ctx, skill)) {
    return (
      <p className="empty">
        {ctx.hideAllStreaks
          ? 'Streaks are hidden. Use Show streaks at the top of the page to see them again.'
          : `${skill.name}'s streak is hidden. Open its ⋯ menu and choose Show streak.`}
      </p>
    )
  }

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
  if (!skill) return <NoHabit ctx={ctx} />

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
  if (!skill) return <NoHabit ctx={ctx} />

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
        Set per habit ({skill.name}).
      </p>
    </div>
  )
}
