import { useState } from 'react'
import { format } from 'date-fns'
import { workoutsApi, type NewMeal, type NewWorkout } from '../../lib/api'
import { buildMetric } from '../../lib/calendarMetrics'
import { toDateKey, todayKey } from '../../lib/dates'
import type { DayEntries } from '../../lib/useDayEntries'
import { useDayEntries } from '../../lib/useDayEntries'
import type { Integration, Meal, Workout } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'
import { CALORIE_GOAL } from '../diet/constants'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import LiftingPanel from './LiftingPanel'
import { CheckInHistoryPanel, CheckInProgressPanel, ClassHistoryPanel, PaymentHistoryPanel } from './CrunchPanels'
import { useCrunch } from './useCrunch'

const isFitnessConnector = (i: Integration) => i.category === 'fitness'

const num = (v: string) => Math.max(0, parseInt(v, 10) || 0)

/** Meals are logged on the Diet page. They are only read here, to work out calories left after exercise. */
export default function FitnessPage({ meals }: { meals: DayEntries<Meal, NewMeal> }) {
  const layout = useLayoutEditing()
  const crunch = useCrunch()
  const log = useDayEntries<Workout, NewWorkout>(workoutsApi)
  const [workout, setWorkout] = useState({ type: '', durationMin: '', caloriesBurned: '' })

  // The numbers and the list are for today. The calendar below looks across every day.
  const today = todayKey()
  const workouts = log.items.filter((w) => w.date === today)
  const eaten = meals.items.filter((m) => m.date === today).reduce((s, m) => s + m.calories, 0)
  const burned = workouts.reduce((s, w) => s + w.caloriesBurned, 0)
  const remaining = CALORIE_GOAL - eaten + burned

  const addWorkout = async (e: React.FormEvent) => {
    e.preventDefault()
    const minutes = num(workout.durationMin)
    if (!workout.type.trim() || minutes < 1) return
    const saved = await log.add({
      type: workout.type.trim(),
      durationMin: minutes,
      caloriesBurned: num(workout.caloriesBurned),
      date: today,
    })
    if (saved) setWorkout({ type: '', durationMin: '', caloriesBurned: '' })
  }

  // Gym visits and classes come from Crunch (when it is connected); workouts are the ones logged here.
  const checkIns = crunch.data?.checkIns ?? []
  const classes = (crunch.data?.classes ?? []).filter((c) => c.status.toLowerCase() === 'attended')
  const metrics = [
    buildMetric({ id: 'workouts', label: 'Workout minutes', color: '#4f46e5', format: (n: number) => `${n} min` }, log.items, (w) => ({
      day: w.date,
      amount: w.durationMin,
      line: `${w.type} · ${w.durationMin} min`,
    })),
    buildMetric({ id: 'burned', label: 'Calories burned', color: '#f97316', format: (n: number) => `${n} kcal`, off: true }, log.items, (w) => ({
      day: w.date,
      amount: w.caloriesBurned,
    })),
    buildMetric({ id: 'checkins', label: 'Gym check-ins', color: '#16a34a', format: (n: number) => (n === 1 ? '1 check-in' : `${n} check-ins`) }, checkIns, (c) => ({
      day: toDateKey(new Date(c.at)),
      amount: 1,
      line: `${format(new Date(c.at), 'h:mm a')}${c.club ? ` · ${c.club}` : ''}`,
    })),
    buildMetric({ id: 'classes', label: 'Classes attended', color: '#db2777', format: (n: number) => (n === 1 ? '1 class' : `${n} classes`) }, classes, (c) => ({
      day: c.startsAt.slice(0, 10),
      amount: 1,
      line: c.program,
    })),
  ]
  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Fitness</h1>
          <p>Today's workouts and calories burned. Meals are on the Diet page. The calendar shows every day.</p>
        </div>
        <div className="row">
          <PanelFilter page="fitness" />
          <ConnectorsButton filter={isFitnessConnector} title="Fitness connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

      {log.error && (
        <div className="banner error" role="alert">
          <span>{log.error}</span>
        </div>
      )}

      <Board page="fitness" editing={layout.editing} onEditingChange={layout.setEditing}>
        <Panel id="eaten" title="Eaten" size="third">
          <div className="card">
            <div className="stat-label">Eaten (goal {CALORIE_GOAL})</div>
            <div className="stat-value">{eaten} kcal</div>
            <div className={`bar ${eaten > CALORIE_GOAL ? 'over' : ''}`}>
              <span style={{ width: `${Math.min(100, (eaten / CALORIE_GOAL) * 100)}%` }} />
            </div>
          </div>
        </Panel>

        <Panel id="burned" title="Burned" size="third">
          <div className="card">
            <div className="stat-label">Burned</div>
            <div className="stat-value">{burned} kcal</div>
          </div>
        </Panel>

        <Panel id="remaining" title="Remaining" size="third">
          <div className="card">
            <div className="stat-label">Remaining</div>
            <div className={`stat-value ${remaining >= 0 ? 'good' : 'bad'}`}>{remaining} kcal</div>
          </div>
        </Panel>

        <Panel id="workouts" title="Workouts" size="full">
          <section className="card">
            <h2>Workouts</h2>
            <form className="form" onSubmit={addWorkout}>
              <input
                placeholder="Type (Run, Lift...)"
                value={workout.type}
                onChange={(e) => setWorkout({ ...workout, type: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="Minutes"
                value={workout.durationMin}
                onChange={(e) => setWorkout({ ...workout, durationMin: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="kcal burned"
                value={workout.caloriesBurned}
                onChange={(e) => setWorkout({ ...workout, caloriesBurned: e.target.value })}
              />
              <button className="primary" type="submit">
                Add
              </button>
            </form>
            {workouts.length === 0 ? (
              <p className="empty">No workouts logged today.</p>
            ) : (
              <ul className="list">
                {workouts.map((w) => (
                  <li key={w.id}>
                    <span>
                      {w.type}
                      <br />
                      <span className="stat-label">{w.durationMin} min</span>
                    </span>
                    <span className="row">
                      <strong>{w.caloriesBurned} kcal</strong>
                      <button className="link" aria-label={`Remove ${w.type}`} onClick={() => void log.remove(w.id)}>
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>

        <Panel id="lifting" title="Strong and phone workouts" size="full">
          <LiftingPanel workouts={log.items} onImported={log.reload} />
        </Panel>

        <Panel id="crunch-progress" title="Club Check-In Progress" size="half">
          <CheckInProgressPanel crunch={crunch} />
        </Panel>

        <Panel id="crunch-checkins" title="Club Check-In History" size="half">
          <CheckInHistoryPanel crunch={crunch} />
        </Panel>

        <Panel id="crunch-classes" title="Class History" size="half">
          <ClassHistoryPanel crunch={crunch} />
        </Panel>

        <Panel id="crunch-payments" title="Payment History" size="half">
          <PaymentHistoryPanel crunch={crunch} />
        </Panel>

        <Panel id="calendar" title="Calendar" size="full">
          <MetricCalendar metrics={metrics} />
        </Panel>
      </Board>
    </>
  )
}
