import { useEffect, useState } from 'react'
import { skillsApi } from '../../lib/api'
import { todayKey } from '../../lib/dates'
import { createWriteQueue } from '../../lib/writeQueue'
import Board, { Panel } from '../../components/Board'
import type { PanelSize, Skill } from '../../types'
import {
  AverageWidget,
  CalendarWidget,
  DaysOnOffWidget,
  HabitsWidget,
  StreakWidget,
  type WidgetCtx,
} from './widgets'

/* ---------- Widget registry ---------- */

type WidgetId = 'habits' | 'calendar' | 'streak' | 'daysOnOff' | 'average'

const WIDGETS: Record<WidgetId, { title: string; perHabit: boolean; render: (ctx: WidgetCtx) => React.ReactNode }> = {
  habits: { title: 'Habits', perHabit: false, render: (ctx) => <HabitsWidget ctx={ctx} /> },
  calendar: { title: 'Calendar', perHabit: true, render: (ctx) => <CalendarWidget ctx={ctx} /> },
  streak: { title: 'Streak', perHabit: true, render: (ctx) => <StreakWidget ctx={ctx} /> },
  daysOnOff: { title: 'Days on / off', perHabit: true, render: (ctx) => <DaysOnOffWidget ctx={ctx} /> },
  average: { title: 'Weekly average', perHabit: true, render: (ctx) => <AverageWidget ctx={ctx} /> },
}

// Which widgets start where. The person's own arrangement is kept by the Board.
const WIDGET_SIZES: Record<WidgetId, PanelSize> = {
  habits: 'full',
  calendar: 'half',
  streak: 'half',
  daysOnOff: 'half',
  average: 'half',
}

/* ---------- Habits data ---------- */

const COLORS = ['#4f46e5', '#db2777', '#0891b2', '#16a34a', '#d97706', '#9333ea']

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** The same change the server makes when a day is toggled, applied locally for instant feedback. */
const withDayToggled = (skill: Skill, key: string): Skill => {
  const has = skill.logs.includes(key)
  return {
    ...skill,
    logs: has ? skill.logs.filter((l) => l !== key) : [...skill.logs, key].sort(),
    // Logging a day before the start date moves the start back to it.
    startDate: !has && key < skill.startDate ? key : skill.startDate,
  }
}

/* ---------- Page ---------- */

export default function HabitsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null)
  const showToast = (text: string, undo?: () => void) => setToast({ message: text, undo })
  // The message goes away by itself after a few seconds.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 8000)
    return () => window.clearTimeout(timer)
  }, [toast])

  // Writes to the API run one at a time, in order. If one fails, show why and
  // re-sync with what the server actually has.
  const [writes] = useState(() =>
    createWriteQueue(async (err) => {
      setMessage(errorText(err))
      try {
        setSkills(await skillsApi.list())
      } catch {
        setStatus('error')
      }
    }),
  )

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    skillsApi
      .list()
      .then((list) => {
        if (cancelled) return
        setSkills(list)
        setStatus('ready')
        setMessage(null)
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setMessage(errorText(err))
        // The API may still be starting (for example right after `npm run n`), so try again.
        retryTimer = setTimeout(() => setReloadKey((k) => k + 1), 3000)
      })
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [reloadKey])

  const retry = () => {
    setStatus('loading')
    setMessage(null)
    setReloadKey((k) => k + 1)
  }

  // Archived habits are put away: they stay out of the list and the other widgets until restored.
  const active = skills.filter((s) => !s.archived)
  const archived = skills.filter((s) => s.archived)
  const selected = active.find((s) => s.id === selectedId) ?? active[0]

  const setArchived = (habit: Skill, value: boolean) => {
    setSkills((prev) => prev.map((s) => (s.id === habit.id ? { ...s, archived: value } : s)))
    writes.enqueue(async () => {
      await skillsApi.update(habit.id, { archived: value })
    })
    if (value) showToast(`Archived "${habit.name}". Restore or delete it from Show archived.`, () => setArchived(habit, false))
    else setToast(null)
  }

  const ctx: WidgetCtx = {
    skills: active,
    archived,
    selected,
    setArchived,
    removeHabit: (habit) => {
      setSkills((prev) => prev.filter((s) => s.id !== habit.id))
      writes.enqueue(async () => {
        await skillsApi.remove(habit.id)
      })
    },
    status,
    select: setSelectedId,
    addHabit: (name) =>
      writes.enqueue(async () => {
        const created = await skillsApi.create({
          name,
          color: COLORS[skills.length % COLORS.length],
          startDate: todayKey(),
        })
        setSkills((prev) => [...prev, created])
        setSelectedId(created.id)
      }),
    toggleDay: (id, key) => {
      // Update the screen right away, then save.
      setSkills((prev) => prev.map((s) => (s.id === id ? withDayToggled(s, key) : s)))
      writes.enqueue(async () => {
        const saved = await skillsApi.toggleDay(id, key)
        // With more writes still queued, the server copy is already out of date.
        if (writes.pending === 1) setSkills((prev) => prev.map((s) => (s.id === id ? saved : s)))
      })
    },
    setAvgWeeks: (id, weeks) => {
      if (!Number.isFinite(weeks)) return
      const avgWeeks = Math.min(52, Math.max(1, Math.round(weeks)))
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, avgWeeks } : s)))
      writes.enqueue(async () => {
        await skillsApi.update(id, { avgWeeks })
      })
    },
  }

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Habits</h1>
          <p>Click a habit to show it in the other widgets. Customize layout to rearrange the widgets.</p>
        </div>
      </header>

      {message && (
        <div className="banner error" role="alert">
          <span>{message}</span>
          <span className="row">
            {status === 'error' && <button onClick={retry}>Retry</button>}
            <button className="link" onClick={() => setMessage(null)} aria-label="Dismiss message">
              ✕
            </button>
          </span>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
          <button className="link" onClick={() => setToast(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <Board page="habits">
        {(Object.keys(WIDGETS) as WidgetId[]).map((id) => {
          const widget = WIDGETS[id]
          return (
            <Panel key={id} id={id} title={widget.title} size={WIDGET_SIZES[id]}>
              <article className="card widget">
                <div className="widget-head">
                  <h2>{widget.title}</h2>
                  {widget.perHabit && selected && <span className="muted widget-sub">{selected.name}</span>}
                </div>
                <div className="widget-body">{widget.render(ctx)}</div>
              </article>
            </Panel>
          )
        })}
      </Board>
    </>
  )
}
