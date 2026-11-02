import { useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { workoutsApi } from '../../lib/api'
import type { Workout } from '../../types'

const SOURCE = { strong: 'Strong', 'health-connect': 'Phone' } as const

/** One set as it is written in a log: "135 x 8", "30 s", "5000 m". */
function setText(set: { weight?: number; reps?: number; seconds?: number; distance?: number }, unit?: string): string {
  const parts: string[] = []
  if (set.weight !== undefined && set.reps !== undefined) parts.push(`${set.weight}${unit ? ` ${unit}` : ''} x ${set.reps}`)
  else if (set.reps !== undefined) parts.push(`${set.reps} reps`)
  else if (set.weight !== undefined) parts.push(`${set.weight}${unit ? ` ${unit}` : ''}`)
  if (set.distance !== undefined) parts.push(`${set.distance} m`)
  if (set.seconds !== undefined) parts.push(`${set.seconds} s`)
  return parts.join(', ') || 'done'
}

/**
 * Workouts that came from outside: a Strong export the person picks here, and sessions the phone app reads from Health
 * Connect. It shows the latest ones with their sets, so the lifts are on the page and not just the minutes.
 */
export default function LiftingPanel({ workouts, onImported }: { workouts: Workout[]; onImported: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const done = await workoutsApi.importStrong(await file.text())
      await onImported()
      setMessage({
        text: `Read ${done.added + done.updated} workouts: ${done.added} new, ${done.updated} already here.`,
        bad: false,
      })
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Couldn't read that file.", bad: true })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = '' // so the same file can be picked again
    }
  }

  const imported = workouts
    .filter((w) => w.source === 'strong' || w.source === 'health-connect')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)

  return (
    <section className="card">
      <h2>Strong and phone workouts</h2>
      <p className="muted">
        In Strong, open Profile, then Settings, then Export Strong Data, and pick the file here to bring in every workout with its sets. The
        Valkyrie phone app also adds the workouts your phone knows about, through Health Connect.
      </p>
      <div className="row">
        <input ref={input} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading...' : 'Import a Strong export'}
        </button>
      </div>
      {message && (
        <p className={message.bad ? 'error' : 'muted'} role="status">
          {message.text}
        </p>
      )}

      {imported.length === 0 ? (
        <p className="empty">Nothing from Strong or the phone yet.</p>
      ) : (
        <ul className="list">
          {imported.map((w) => (
            <li key={w.id}>
              {w.exercises && w.exercises.length > 0 ? (
                <details>
                  <summary>
                    <strong>{w.type}</strong> <span className="stat-label">{format(parseISO(w.date), 'MMM d, yyyy')} · {w.durationMin} min · {SOURCE[w.source as keyof typeof SOURCE]}</span>
                  </summary>
                  <ul className="list">
                    {w.exercises.map((e) => (
                      <li key={e.name}>
                        <span>
                          {e.name}
                          <br />
                          <span className="stat-label">{e.sets.map((s) => setText(s, w.unit)).join('  ·  ')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <span>
                  <strong>{w.type}</strong>{' '}
                  <span className="stat-label">{format(parseISO(w.date), 'MMM d, yyyy')} · {w.durationMin} min · {SOURCE[w.source as keyof typeof SOURCE]}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
