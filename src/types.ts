export type Tracker = {
  id: string
  name: string
  startDate: string // YYYY-MM-DD
  color: string
  notes?: string
}

export type Skill = {
  id: string
  name: string
  color: string
  startDate: string // YYYY-MM-DD, first day of the skill
  logs: string[] // YYYY-MM-DD days the skill was practiced ("days on")
  avgWeeks: number // number of weeks used for the weekly average
}

export type Transaction = {
  id: string
  type: 'income' | 'expense'
  amountCents: number
  category: string
  date: string // YYYY-MM-DD
  note?: string
}

export type Meal = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

export type Workout = {
  id: string
  type: string
  durationMin: number
  caloriesBurned: number
}

export type TimeEntry = {
  id: string
  label: string
  category: string
  start: string // ISO timestamp
  end?: string // undefined while running
}

export type CalendarEvent = {
  id: string
  title: string
  date: string // YYYY-MM-DD
}
