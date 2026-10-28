import { useState } from 'react'
import { uid } from '../../lib/dates'
import type { Meal, Workout } from '../../types'

const CALORIE_GOAL = 2200

const SEED_MEALS: Meal[] = [
  { id: 'm1', name: 'Oatmeal & banana', calories: 380, protein: 12, carbs: 68, fat: 7 },
  { id: 'm2', name: 'Chicken burrito bowl', calories: 720, protein: 48, carbs: 70, fat: 24 },
]

const SEED_WORKOUTS: Workout[] = [{ id: 'w1', type: 'Run', durationMin: 35, caloriesBurned: 340 }]

const num = (v: string) => Math.max(0, parseInt(v, 10) || 0)

export default function FitnessPage() {
  const [meals, setMeals] = useState<Meal[]>(SEED_MEALS)
  const [workouts, setWorkouts] = useState<Workout[]>(SEED_WORKOUTS)

  const [meal, setMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' })
  const [workout, setWorkout] = useState({ type: '', durationMin: '', caloriesBurned: '' })

  const eaten = meals.reduce((s, m) => s + m.calories, 0)
  const burned = workouts.reduce((s, w) => s + w.caloriesBurned, 0)
  const remaining = CALORIE_GOAL - eaten + burned
  const protein = meals.reduce((s, m) => s + m.protein, 0)
  const carbs = meals.reduce((s, m) => s + m.carbs, 0)
  const fat = meals.reduce((s, m) => s + m.fat, 0)

  const addMeal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!meal.name.trim() || !meal.calories) return
    setMeals((p) => [
      ...p,
      {
        id: uid(),
        name: meal.name.trim(),
        calories: num(meal.calories),
        protein: num(meal.protein),
        carbs: num(meal.carbs),
        fat: num(meal.fat),
      },
    ])
    setMeal({ name: '', calories: '', protein: '', carbs: '', fat: '' })
  }

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
      <header className="page-header">
        <h1>Fitness</h1>
        <p>Today's calories, macros, and workouts.</p>
      </header>

      <div className="stack">
        <div className="grid cols-3">
          <div className="card">
            <div className="stat-label">Eaten (goal {CALORIE_GOAL})</div>
            <div className="stat-value">{eaten} kcal</div>
            <div className={`bar ${eaten > CALORIE_GOAL ? 'over' : ''}`}>
              <span style={{ width: `${Math.min(100, (eaten / CALORIE_GOAL) * 100)}%` }} />
            </div>
          </div>
          <div className="card">
            <div className="stat-label">Burned</div>
            <div className="stat-value">{burned} kcal</div>
          </div>
          <div className="card">
            <div className="stat-label">Remaining</div>
            <div className={`stat-value ${remaining >= 0 ? 'good' : 'bad'}`}>{remaining} kcal</div>
          </div>
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>Meals</h2>
            <form className="form" onSubmit={addMeal}>
              <input
                placeholder="Meal"
                value={meal.name}
                onChange={(e) => setMeal({ ...meal, name: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="kcal"
                value={meal.calories}
                onChange={(e) => setMeal({ ...meal, calories: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="P (g)"
                value={meal.protein}
                onChange={(e) => setMeal({ ...meal, protein: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="C (g)"
                value={meal.carbs}
                onChange={(e) => setMeal({ ...meal, carbs: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="F (g)"
                value={meal.fat}
                onChange={(e) => setMeal({ ...meal, fat: e.target.value })}
              />
              <button className="primary" type="submit">
                Add
              </button>
            </form>
            {meals.length === 0 ? (
              <p className="empty">No meals logged today.</p>
            ) : (
              <ul className="list">
                {meals.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.name}
                      <br />
                      <span className="stat-label">
                        P {m.protein}g · C {m.carbs}g · F {m.fat}g
                      </span>
                    </span>
                    <span className="row">
                      <strong>{m.calories} kcal</strong>
                      <button
                        className="link"
                        aria-label="Delete meal"
                        onClick={() => setMeals((p) => p.filter((x) => x.id !== m.id))}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>
              Totals: P {protein}g · C {carbs}g · F {fat}g
            </p>
          </section>

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
                      <button
                        className="link"
                        aria-label="Delete workout"
                        onClick={() => setWorkouts((p) => p.filter((x) => x.id !== w.id))}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
