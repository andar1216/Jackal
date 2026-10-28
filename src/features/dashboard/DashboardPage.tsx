import { useCallback, useEffect, useState } from 'react'
import { skillsApi } from '../../lib/api'
import ConnectModal from '../connections/ConnectModal'
import { todayKey } from '../../lib/dates'
import { createWriteQueue } from '../../lib/writeQueue'
import type { Skill } from '../../types'
import {
  AverageWidget,
  CalendarWidget,
  DaysOnOffWidget,
  SkillsWidget,
  StreakWidget,
  type WidgetCtx,
} from './widgets'

/* ---------- Widget registry ---------- */

type WidgetId = 'skills' | 'calendar' | 'streak' | 'daysOnOff' | 'average'

const WIDGETS: Record<WidgetId, { title: string; perSkill: boolean; render: (ctx: WidgetCtx) => React.ReactNode }> = {
  skills: { title: 'Skills', perSkill: false, render: (ctx) => <SkillsWidget ctx={ctx} /> },
  calendar: { title: 'Calendar', perSkill: true, render: (ctx) => <CalendarWidget ctx={ctx} /> },
  streak: { title: 'Streak', perSkill: true, render: (ctx) => <StreakWidget ctx={ctx} /> },
  daysOnOff: { title: 'Days on / off', perSkill: true, render: (ctx) => <DaysOnOffWidget ctx={ctx} /> },
  average: { title: 'Weekly average', perSkill: true, render: (ctx) => <AverageWidget ctx={ctx} /> },
}

type LayoutItem = { id: WidgetId; wide: boolean }

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'skills', wide: true },
  { id: 'calendar', wide: false },
  { id: 'streak', wide: false },
  { id: 'daysOnOff', wide: false },
  { id: 'average', wide: false },
]

/* ---------- Skills data ---------- */

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

export default function DashboardPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT)
  const [connectOpen, setConnectOpen] = useState(false)
  const closeConnect = useCallback(() => setConnectOpen(false), [])

  const [dragId, setDragId] = useState<WidgetId | null>(null)
  const [overId, setOverId] = useState<WidgetId | null>(null)

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

  const selected = skills.find((s) => s.id === selectedId) ?? skills[0]

  const ctx: WidgetCtx = {
    skills,
    selected,
    status,
    select: setSelectedId,
    addSkill: (name) =>
      writes.enqueue(async () => {
        const created = await skillsApi.create({
          name,
          color: COLORS[skills.length % COLORS.length],
          startDate: todayKey(),
        })
        setSkills((prev) => [...prev, created])
        setSelectedId(created.id)
      }),
    removeSkill: (id) => {
      setSkills((prev) => prev.filter((s) => s.id !== id))
      writes.enqueue(() => skillsApi.remove(id))
    },
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

  /* ----- layout actions ----- */

  const moveTo = (from: WidgetId, to: WidgetId) =>
    setLayout((prev) => {
      const i = prev.findIndex((w) => w.id === from)
      const j = prev.findIndex((w) => w.id === to)
      if (i < 0 || j < 0 || i === j) return prev
      const next = [...prev]
      const [item] = next.splice(i, 1)
      next.splice(j, 0, item)
      return next
    })

  const moveBy = (id: WidgetId, delta: number) =>
    setLayout((prev) => {
      const i = prev.findIndex((w) => w.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const toggleWide = (id: WidgetId) =>
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, wide: !w.wide } : w)))

  const hide = (id: WidgetId) => setLayout((prev) => prev.filter((w) => w.id !== id))

  const show = (id: WidgetId) => setLayout((prev) => [...prev, { id, wide: false }])

  const hidden = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !layout.some((w) => w.id === id))

  const endDrag = () => {
    setDragId(null)
    setOverId(null)
  }

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Dashboard</h1>
          <p>Drag a widget's header to rearrange. Click a skill to show it in the other widgets.</p>
        </div>
        <div className="row">
          <button className="primary" onClick={() => setConnectOpen(true)}>
            Connect
          </button>
          {hidden.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && show(e.target.value as WidgetId)}
              aria-label="Add widget"
            >
              <option value="">+ Add widget</option>
              {hidden.map((id) => (
                <option key={id} value={id}>
                  {WIDGETS[id].title}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setLayout(DEFAULT_LAYOUT)}>Reset layout</button>
        </div>
      </header>

      {connectOpen && <ConnectModal onClose={closeConnect} />}

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

      {layout.length === 0 && <p className="empty">All widgets are hidden. Use "Add widget" to bring them back.</p>}

      <div className="dash-grid">
        {layout.map((item) => {
          const widget = WIDGETS[item.id]
          const classes = [
            'card',
            'widget',
            item.wide ? 'wide' : '',
            dragId === item.id ? 'dragging' : '',
            overId === item.id && dragId && dragId !== item.id ? 'drop-target' : '',
          ]
          return (
            <article
              key={item.id}
              className={classes.join(' ')}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overId !== item.id) setOverId(item.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) moveTo(dragId, item.id)
                endDrag()
              }}
            >
              <div
                className="widget-head"
                draggable
                onDragStart={(e) => {
                  setDragId(item.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', item.id)
                  const article = e.currentTarget.closest('article')
                  if (article) e.dataTransfer.setDragImage(article, 24, 16)
                }}
                onDragEnd={endDrag}
              >
                <span
                  className="drag-handle"
                  role="button"
                  tabIndex={0}
                  aria-label={`Move ${widget.title} widget. Use arrow keys.`}
                  title="Drag to move (or focus and use arrow keys)"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                      e.preventDefault()
                      moveBy(item.id, -1)
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                      e.preventDefault()
                      moveBy(item.id, 1)
                    }
                  }}
                >
                  ⠿
                </span>
                <h2>{widget.title}</h2>
                {widget.perSkill && selected && <span className="muted widget-sub">{selected.name}</span>}
                <span className="widget-actions">
                  <button
                    className="link"
                    onClick={() => toggleWide(item.id)}
                    aria-label={item.wide ? 'Make widget half width' : 'Make widget full width'}
                    title={item.wide ? 'Half width' : 'Full width'}
                  >
                    {item.wide ? '⇲' : '⇱'}
                  </button>
                  <button className="link" onClick={() => hide(item.id)} aria-label={`Hide ${widget.title}`} title="Hide">
                    ✕
                  </button>
                </span>
              </div>
              <div className="widget-body">{widget.render(ctx)}</div>
            </article>
          )
        })}
      </div>
    </>
  )
}
