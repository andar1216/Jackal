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

export type Integration = {
  id: string
  name: string
  description: string
  category: 'calendar' | 'finance' | 'fitness' | 'screen-time'
  note?: string
  /** False until the connection flow for this service is built. */
  available: boolean
  status: 'connected' | 'not_connected'
  connectedAt?: string
  accountLabel?: string
}

export type Transaction = {
  id: string
  type: 'income' | 'expense'
  amountCents: number
  category: string
  date: string // YYYY-MM-DD
  note?: string
  source?: 'manual' | 'plaid' // imported bank transactions are 'plaid'
  accountName?: string
  isRefund?: boolean // money back onto a credit card: lowers spending, is not income
}

/** A named group of accounts, like Business or Personal. Accounts are listed by the name Finances shows for them. */
export type AccountView = {
  id: string
  name: string
  accounts: string[]
}

/** An account the person listed by hand. */
export type ManualAccount = {
  id: string
  name: string
  kind: 'bank' | 'credit'
  mask?: string
  balanceCents?: number // for a card, what is owed
}

/** A bank or card account that came in through Plaid. */
export type BankAccount = {
  label: string
  institution: string
  type?: string // 'credit' for credit cards
  balanceCents?: number // as of the last sync; for a card or loan, what is owed
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

export type User = {
  id: string
  email: string
  name: string
}
