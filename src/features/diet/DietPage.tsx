import { useState } from 'react'
import { uid } from '../../lib/dates'
import type { Meal } from '../../types'
import { CALORIE_GOAL } from './constants'

const num = (v: string) => Math.max(0, parseInt(v, 10) || 0)

type Props = { meals: Meal[]; setMeals: React.Dispatch<React.SetStateAction<Meal[]>> }

export default function DietPage({ meals, setMeals }: Props) {
  const [meal, setMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' })

  const eaten = meals.reduce((s, m) => s + m.calories, 0)
  const remaining = CALORIE_GOAL - eaten
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

  return (
    <>
      <header className="page-header">
        <h1>Diet</h1>
        <p>Today's meals, calories, and macros.</p>
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
            <div className="stat-label">Left for today</div>
            <div className={`stat-value ${remaining >= 0 ? 'good' : 'bad'}`}>{remaining} kcal</div>
          </div>
          <div className="card">
            <div className="stat-label">Macros</div>
            <div className="stat-value">P {protein}g</div>
            <div className="stat-label">
              C {carbs}g · F {fat}g
            </div>
          </div>
        </div>

        <section className="card">
          <h2>Meals</h2>
          <form className="form" onSubmit={addMeal}>
            <input placeholder="Meal" value={meal.name} onChange={(e) => setMeal({ ...meal, name: e.target.value })} />
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
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
