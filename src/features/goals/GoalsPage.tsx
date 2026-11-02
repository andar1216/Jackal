import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { goalsApi, type GoalInput, type GoalTaskInput } from '../../lib/api'
import Board, { Panel } from '../../components/Board'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import { formatDay, formatMoney, todayKey } from '../../lib/dates'
import type { Goal, GoalPriority, GoalTask } from '../../types'
import {
  dollarsForInput,
  dueText,
  formatMinutes,
  goalStats,
  goalWarnings,
  minutesForInput,
  orderedGoals,
  orderedSteps,
  parseDollars,
  parseMinutes,
} from './goalMath'

const COLORS = ['#4f46e5', '#db2777', '#0891b2', '#16a34a', '#d97706', '#9333ea']
const CATEGORIES = ['Health', 'Money', 'Career', 'Learning', 'Home', 'Relationships', 'Travel', 'Personal']
const PRIORITIES: GoalPriority[] = ['high', 'medium', 'low']
const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
] as const
type Filter = (typeof FILTERS)[number]['id']

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function GoalsPage() {
  const layout = useLayoutEditing()
  const [goals, setGoals] = useState<Goal[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filter, setFilter] = useState<Filter>('active')
  const [adding, setAdding] = useState(false)
  const today = todayKey()

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    goalsApi
      .list()
      .then((list) => {
        if (cancelled) return
        setGoals(list)
        setStatus('ready')
        setMessage(null)
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setMessage(errorText(err))
        retryTimer = setTimeout(() => setReloadKey((k) => k + 1), 3000) // the server may still be starting
      })
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [reloadKey])

  /** Runs a change, then swaps the goal the server sent back in. */
  const change = async (run: () => Promise<Goal | void>, id?: string) => {
    try {
      const result = await run()
      setMessage(null)
      if (result) setGoals((all) => (all.some((g) => g.id === result.id) ? all.map((g) => (g.id === result.id ? result : g)) : [...all, result]))
      else if (id) setGoals((all) => all.filter((g) => g.id !== id))
      return true
    } catch (err) {
      setMessage(errorText(err))
      return false
    }
  }

  const active = goals.filter((g) => g.status === 'active')
  const openSteps = active.flatMap((g) => g.tasks.filter((t) => !t.done))
  const costToGo = openSteps.reduce((s, t) => s + (t.costCents ?? 0), 0)
  const timeToGo = openSteps.reduce((s, t) => s + (t.minutes ?? 0), 0)
  // The soonest day anything is due: a goal's deadline or one of its steps'.
  const deadlines = active.flatMap((g) => [
    ...(g.dueDate ? [{ day: g.dueDate, what: g.title }] : []),
    ...g.tasks.flatMap((t) => (!t.done && t.dueDate ? [{ day: t.dueDate, what: t.title }] : [])),
  ])
  const nextDeadline = deadlines.sort((x, y) => x.day.localeCompare(y.day))[0]
  const shown = orderedGoals(filter === 'all' ? goals : goals.filter((g) => g.status === filter))

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Goals</h1>
          <p>Set a goal, break it into steps, and give each step a deadline, a cost and the time it takes.</p>
        </div>
        <div className="row">
          <PanelFilter page="goals" />
          <SettingsMenu items={[layout.item]} />
          <button className="primary row" onClick={() => setAdding((a) => !a)}>
            <Plus size={16} aria-hidden /> {adding ? 'Close' : 'Add goal'}
          </button>
        </div>
      </header>

      {message && (
        <div className="banner error" role="alert">
          <span>{message}</span>
        </div>
      )}

      {adding && (
        <section className="card goal-add">
          <h2>New goal</h2>
          <GoalForm
            today={today}
            submitLabel="Add goal"
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              if (await change(() => goalsApi.create(input))) setAdding(false)
            }}
          />
        </section>
      )}

      <div className="segmented goal-filter" role="group" aria-label="Show goals">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Every card is a board: press it and drag it, pull its sides to resize it, click it to put it away. */}
      <Board
        page="goals"
        editing={layout.editing}
        onEditingChange={layout.setEditing}
        emptyText={status === 'loading' ? 'Loading...' : goals.length === 0 ? 'No goals yet. Add one to get started.' : 'No goals here.'}
      >
        <Panel id="overview" title="Active goals" size="third">
          <div className="card">
            <div className="stat-label">Active goals</div>
            <div className="stat-value">{active.length}</div>
            <div className="stat-label">
              {openSteps.length} {openSteps.length === 1 ? 'step' : 'steps'} left
            </div>
          </div>
        </Panel>

        <Panel id="to-go" title="Cost and time to go" size="third">
          <div className="card">
            <div className="stat-label">Cost to go</div>
            <div className="stat-value">{formatMoney(costToGo)}</div>
            <div className="stat-label">Time to go {formatMinutes(timeToGo)}</div>
          </div>
        </Panel>

        <Panel id="next" title="Next deadline" size="third">
          <div className="card">
            <div className="stat-label">Next deadline</div>
            <div className="stat-value">{nextDeadline ? formatDay(nextDeadline.day) : 'None'}</div>
            <div className="stat-label">{nextDeadline ? `${nextDeadline.what} · ${dueText(nextDeadline.day, today)}` : 'Give a goal or step a date'}</div>
          </div>
        </Panel>

        {shown.map((goal) => (
          <Panel key={goal.id} id={`goal:${goal.id}`} title={goal.title} size="full">
            <GoalCard goal={goal} today={today} change={change} />
          </Panel>
        ))}
      </Board>
    </>
  )
}
/* ---------- One goal ---------- */

type Change = (run: () => Promise<Goal | void>, id?: string) => Promise<boolean>

function GoalCard({ goal, today, change }: { goal: Goal; today: string; change: Change }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(true)
  const [addingStep, setAddingStep] = useState(false)
  const stats = goalStats(goal, today)
  const warnings = goalWarnings(goal, stats)
  const finished = goal.status === 'done'

  const remove = () => {
    if (window.confirm(`Delete "${goal.title}" and its ${goal.tasks.length} steps?`)) void change(() => goalsApi.remove(goal.id), goal.id)
  }

  if (editing) {
    return (
      <section className="card goal-card" style={{ borderLeftColor: goal.color }}>
        <h2>Edit goal</h2>
        <GoalForm
          initial={goal}
          today={today}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            if (await change(() => goalsApi.update(goal.id, input))) setEditing(false)
          }}
        />
      </section>
    )
  }

  return (
    <section className={`card goal-card ${finished ? 'finished' : ''}`} style={{ borderLeftColor: goal.color }}>
      <div className="row between goal-head">
        <div>
          <h2 className="goal-title">
            <button className="link" aria-expanded={open} aria-label={open ? 'Hide steps' : 'Show steps'} onClick={() => setOpen((o) => !o)}>
              {open ? '▾' : '▸'}
            </button>
            {goal.title}
          </h2>
          <div className="row goal-tags">
            {goal.category && <span className="pill">{goal.category}</span>}
            <span className={`pill priority-${goal.priority}`}>{capital(goal.priority)} priority</span>
            {goal.status === 'paused' && <span className="pill">Paused</span>}
            {finished && <span className="pill good-pill">Done</span>}
            {goal.dueDate && (
              <span className={stats.late ? 'bad' : 'muted'}>
                {finished ? `Deadline ${formatDay(goal.dueDate)}` : `${dueText(goal.dueDate, today)} · ${formatDay(goal.dueDate)}`}
              </span>
            )}
          </div>
        </div>
        <div className="row">
          <button onClick={() => setEditing(true)}>Edit</button>
          {goal.status === 'paused' ? (
            <button onClick={() => void change(() => goalsApi.update(goal.id, { status: 'active' }))}>Resume</button>
          ) : (
            !finished && <button onClick={() => void change(() => goalsApi.update(goal.id, { status: 'paused' }))}>Pause</button>
          )}
          <button className={finished ? '' : 'primary'} onClick={() => void change(() => goalsApi.update(goal.id, { status: finished ? 'active' : 'done' }))}>
            {finished ? 'Reopen' : 'Mark done'}
          </button>
          <button className="link danger" aria-label={`Delete ${goal.title}`} onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      {goal.notes && <p className="muted goal-notes">{goal.notes}</p>}

      <div className="bar goal-bar" role="progressbar" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <span style={{ width: `${stats.percent}%`, background: goal.color }} />
      </div>
      <div className="row goal-facts">
        <span>
          <strong>{stats.done}</strong> of {stats.total} steps
        </span>
        <span className="muted">
          Cost {formatMoney(stats.costDone)} of {formatMoney(stats.costTotal)}
          {goal.budgetCents !== undefined && ` · budget ${formatMoney(goal.budgetCents)}`}
        </span>
        <span className="muted">
          Time {formatMinutes(stats.minutesDone)} of {formatMinutes(stats.minutesTotal)}
          {goal.budgetMinutes !== undefined && ` · planned ${formatMinutes(goal.budgetMinutes)}`}
        </span>
        {stats.overdue > 0 && <span className="bad">{stats.overdue} overdue</span>}
      </div>
      {warnings.map((w) => (
        <div key={w} className="banner info goal-warning">
          <span>{w}</span>
        </div>
      ))}

      {open && (
        <div className="goal-steps">
          {goal.tasks.length === 0 && !addingStep && <p className="empty">No steps yet. Add the first thing to do.</p>}
          <ul className="list">
            {orderedSteps(goal.tasks).map((task) => (
              <StepRow key={task.id} goal={goal} task={task} today={today} change={change} />
            ))}
          </ul>
          {addingStep ? (
            <StepForm
              submitLabel="Add step"
              goal={goal}
              onCancel={() => setAddingStep(false)}
              onSave={async (input) => {
                if (await change(() => goalsApi.addTask(goal.id, input))) return true
                return false
              }}
              keepOpen
            />
          ) : (
            <button className="row" onClick={() => setAddingStep(true)}>
              <Plus size={14} aria-hidden /> Add step
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* ---------- One step ---------- */

function StepRow({ goal, task, today, change }: { goal: Goal; task: GoalTask; today: string; change: Change }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <li className="goal-step-edit">
        <StepForm
          initial={task}
          goal={goal}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            const ok = await change(() => goalsApi.updateTask(goal.id, task.id, input))
            if (ok) setEditing(false)
            return ok
          }}
        />
      </li>
    )
  }

  const late = !task.done && !!task.dueDate && task.dueDate < today
  const afterGoal = !task.done && !!task.dueDate && !!goal.dueDate && task.dueDate > goal.dueDate
  return (
    <li className={`goal-step ${task.done ? 'done' : ''}`}>
      <label className="goal-check">
        <input type="checkbox" checked={task.done} onChange={(e) => void change(() => goalsApi.updateTask(goal.id, task.id, { done: e.target.checked }))} aria-label={`Done: ${task.title}`} />
        <span>
          <span className="goal-step-title">{task.title}</span>
          {task.notes && <span className="stat-label goal-step-notes"> {task.notes}</span>}
        </span>
      </label>
      <span className="row goal-meta">
        {task.dueDate && (
          <span className={late || afterGoal ? 'bad' : 'muted'} title={afterGoal ? "After the goal's deadline" : undefined}>
            {task.done ? formatDay(task.dueDate) : `${dueText(task.dueDate, today)} · ${formatDay(task.dueDate)}`}
          </span>
        )}
        {task.costCents !== undefined && <span className="goal-chip">{formatMoney(task.costCents)}</span>}
        {task.minutes !== undefined && <span className="goal-chip">{formatMinutes(task.minutes)}</span>}
        <button className="link" onClick={() => setEditing(true)} aria-label={`Edit ${task.title}`}>
          Edit
        </button>
        <button className="link" aria-label={`Remove ${task.title}`} onClick={() => void change(() => goalsApi.removeTask(goal.id, task.id))}>
          ✕
        </button>
      </span>
    </li>
  )
}

/* ---------- Forms ---------- */

type GoalFormProps = {
  initial?: Goal
  today: string
  submitLabel: string
  onSave: (input: GoalInput) => Promise<void>
  onCancel: () => void
}

function GoalForm({ initial, today, submitLabel, onSave, onCancel }: GoalFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [priority, setPriority] = useState<GoalPriority>(initial?.priority ?? 'medium')
  const [startDate, setStartDate] = useState(initial?.startDate ?? today)
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [budget, setBudget] = useState(dollarsForInput(initial?.budgetCents))
  const [time, setTime] = useState(minutesForInput(initial?.budgetMinutes))
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const budgetCents = parseDollars(budget)
    const budgetMinutes = parseMinutes(time)
    if (!title.trim()) return setProblem('Give the goal a name.')
    if (budgetCents === undefined) return setProblem('The budget should be an amount like 500 or 12.50.')
    if (budgetMinutes === undefined) return setProblem('The time should look like 90, 1.5h or 1h 30m.')
    if (dueDate && dueDate < startDate) return setProblem("The deadline can't be before the start date.")
    setProblem(null)
    await onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      category: category.trim(),
      priority,
      color,
      startDate,
      dueDate: dueDate || null,
      budgetCents,
      budgetMinutes,
    })
  }

  return (
    <form className="goal-form" onSubmit={(e) => void submit(e)}>
      <label className="field wide">
        <span className="stat-label">Goal</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Run a half marathon" autoFocus />
      </label>
      <label className="field">
        <span className="stat-label">Category</span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="goal-categories" placeholder="Health" />
        <datalist id="goal-categories">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span className="stat-label">Priority</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {capital(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="stat-label">Start</span>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="stat-label">Deadline</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="stat-label">Budget ($)</span>
        <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Most it should cost" />
      </label>
      <label className="field">
        <span className="stat-label">Time planned</span>
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="Like 40h or 1h 30m" />
      </label>
      <label className="field wide">
        <span className="stat-label">Why / what done looks like</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </label>
      <div className="field">
        <span className="stat-label">Colour</span>
        <div className="row">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      {problem && (
        <div className="banner error wide" role="alert">
          <span>{problem}</span>
        </div>
      )}
      <div className="row wide">
        <button className="primary" type="submit">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

type StepFormProps = {
  initial?: GoalTask
  goal: Goal
  submitLabel: string
  /** Says whether it worked. */
  onSave: (input: GoalTaskInput) => Promise<boolean>
  onCancel: () => void
  /** After a good save the form empties and stays, ready for the next step. */
  keepOpen?: boolean
}

function StepForm({ initial, goal, submitLabel, onSave, onCancel, keepOpen }: StepFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [cost, setCost] = useState(dollarsForInput(initial?.costCents))
  const [time, setTime] = useState(minutesForInput(initial?.minutes))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const costCents = parseDollars(cost)
    const minutes = parseMinutes(time)
    if (!title.trim()) return setProblem('Say what to do.')
    if (costCents === undefined) return setProblem('The cost should be an amount like 40 or 12.50.')
    if (minutes === undefined) return setProblem('The time should look like 90, 1.5h or 1h 30m.')
    setProblem(null)
    const saved = await onSave({ title: title.trim(), notes: notes.trim() || null, dueDate: dueDate || null, costCents, minutes })
    if (saved && keepOpen) {
      setTitle('')
      setDueDate('')
      setCost('')
      setTime('')
      setNotes('')
    }
  }

  return (
    <form className="goal-form step-form" onSubmit={(e) => void submit(e)}>
      <label className="field wide">
        <span className="stat-label">Step</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Buy running shoes" autoFocus />
      </label>
      <label className="field">
        <span className="stat-label">Deadline</span>
        <input type="date" value={dueDate} max={goal.dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      <label className="field">
        <span className="stat-label">Cost ($)</span>
        <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
      </label>
      <label className="field">
        <span className="stat-label">Time</span>
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="1h 30m" />
      </label>
      <label className="field wide">
        <span className="stat-label">Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </label>
      {problem && (
        <div className="banner error wide" role="alert">
          <span>{problem}</span>
        </div>
      )}
      <div className="row wide">
        <button className="primary" type="submit">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {keepOpen ? 'Done' : 'Cancel'}
        </button>
      </div>
    </form>
  )
}