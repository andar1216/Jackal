import { useState } from 'react'
import { uid } from '../../lib/dates'
import type { Integration, Meal, Workout } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'
import { CALORIE_GOAL } from '../diet/constants'
import Board, { Panel } from '../../components/Board'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'

const isFitnessConnector = (i: Integration) => i.category === 'fitness'

const SEED_WORKOUTS: Workout[] = [{ id: 'w1', type: 'Run', durationMin: 35, caloriesBurned: 340 }]

const num = (v: string) => Math.max(0, parseInt(v, 10) || 0)

/** Meals are logged on the Diet page. They are only read here, to work out calories left after exercise. */
export default function FitnessPage({ meals }: { meals: Meal[] }) {
  const layout = useLayoutEditing()
  const [workouts, setWorkouts] = useState<Workout[]>(SEED_WORKOUTS)
  const [workout, setWorkout] = useState({ type: '', durationMin: '', caloriesBurned: '' })

  const eaten = meals.reduce((s, m) => s + m.calories, 0)
  const burned = workouts.reduce((s, w) => s + w.caloriesBurned, 0)
  const remaining = CALORIE_GOAL - eaten + burned

  const addWorkout = (e: React.FormEvent) => {
    e.preventDefault()
    if (!workout.type.trim() || !workout.durationMin) return
    setWorkouts((p) => [
      ...p,
      {
        id: uid(),
        type: workout.type.trim(),
        durationMin: num(workout.durationMin),
        caloriesBurned: num(workout.caloriesBurned),
      },
    ])
    setWorkout({ type: '', durationMin: '', caloriesBurned: '' })
  }

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Fitness</h1>
          <p>Today's workouts and calories burned. Meals are on the Diet page.</p>
        </div>
        <div className="row">
          <ConnectorsButton filter={isFitnessConnector} title="Fitness connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

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
                    </span>
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
