import { useState } from 'react'
import { type NewMeal } from '../../lib/api'
import { todayKey } from '../../lib/dates'
import { buildMetric } from '../../lib/calendarMetrics'
import type { DayEntries } from '../../lib/useDayEntries'
import ConnectorsButton from '../connections/ConnectorsButton'
import type { Integration, Meal } from '../../types'
import { CALORIE_GOAL } from './constants'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'

const isDietConnector = (i: Integration) => i.id === 'myfitnesspal'

const num = (v: string) => Math.max(0, parseInt(v, 10) || 0)

type Props = { meals: DayEntries<Meal, NewMeal> }

export default function DietPage({ meals: log }: Props) {
  const layout = useLayoutEditing()
  const [meal, setMeal] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' })

  // The stats and the list are for today. The calendar below looks across every day.
  const today = todayKey()
  const meals = log.items.filter((m) => m.date === today)
  const eaten = meals.reduce((s, m) => s + m.calories, 0)
  const remaining = CALORIE_GOAL - eaten
  const protein = meals.reduce((s, m) => s + m.protein, 0)
  const carbs = meals.reduce((s, m) => s + m.carbs, 0)
  const fat = meals.reduce((s, m) => s + m.fat, 0)

  const addMeal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!meal.name.trim() || !meal.calories) return
    const saved = await log.add({
      name: meal.name.trim(),
      calories: num(meal.calories),
      protein: num(meal.protein),
      carbs: num(meal.carbs),
      fat: num(meal.fat),
      date: today,
    })
    if (saved) setMeal({ name: '', calories: '', protein: '', carbs: '', fat: '' })
  }

  const grams = (n: number) => `${n} g`
  const mealLine = (m: Meal) => `${m.name} · ${m.calories} kcal`
  const metrics = [
    buildMetric({ id: 'calories', label: 'Calories', color: '#f97316', format: (n) => `${n} kcal` }, log.items, (m) => ({ day: m.date, amount: m.calories, line: mealLine(m) })),
    buildMetric({ id: 'protein', label: 'Protein', color: '#4f46e5', format: grams, off: true }, log.items, (m) => ({ day: m.date, amount: m.protein })),
    buildMetric({ id: 'carbs', label: 'Carbs', color: '#16a34a', format: grams, off: true }, log.items, (m) => ({ day: m.date, amount: m.carbs })),
    buildMetric({ id: 'fat', label: 'Fat', color: '#db2777', format: grams, off: true }, log.items, (m) => ({ day: m.date, amount: m.fat })),
  ]

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Diet</h1>
          <p>Today's meals, calories, and macros. The calendar shows every day.</p>
        </div>
        <div className="row">
          <PanelFilter page="diet" />
          <ConnectorsButton filter={isDietConnector} title="Diet connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

      {log.error && (
        <div className="banner error" role="alert">
          <span>{log.error}</span>
        </div>
      )}

      <Board page="diet" editing={layout.editing} onEditingChange={layout.setEditing}>
        <Panel id="eaten" title="Eaten" size="third">
          <div className="card">
            <div className="stat-label">Eaten (goal {CALORIE_GOAL})</div>
            <div className="stat-value">{eaten} kcal</div>
            <div className={`bar ${eaten > CALORIE_GOAL ? 'over' : ''}`}>
              <span style={{ width: `${Math.min(100, (eaten / CALORIE_GOAL) * 100)}%` }} />
            </div>
          </div>
        </Panel>

        <Panel id="left" title="Left for today" size="third">
          <div className="card">
            <div className="stat-label">Left for today</div>
            <div className={`stat-value ${remaining >= 0 ? 'good' : 'bad'}`}>{remaining} kcal</div>
          </div>
        </Panel>

        <Panel id="macros" title="Macros" size="third">
          <div className="card">
            <div className="stat-label">Macros</div>
            <div className="stat-value">P {protein}g</div>
            <div className="stat-label">
              C {carbs}g · F {fat}g
            </div>
          </div>
        </Panel>

        <Panel id="meals" title="Meals" size="full">
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
                      <button className="link" aria-label={`Remove ${m.name}`} onClick={() => void log.remove(m.id)}>
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>

        <Panel id="calendar" title="Calendar" size="full">
          <MetricCalendar metrics={metrics} />
        </Panel>
      </Board>
    </>
  )
}
