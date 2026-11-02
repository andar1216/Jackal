import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { Goal, GoalTask } from '../../types'

/** Days from `today` to a YYYY-MM-DD day: negative once it has passed. */
export const daysUntil = (day: string, today: string) => differenceInCalendarDays(parseISO(day), parseISO(today))

/** "Due today", "Due in 3 days", "2 days overdue". */
export const dueText = (day: string, today: string) => {
  const n = daysUntil(day, today)
  if (n === 0) return 'Due today'
  if (n === 1) return 'Due tomorrow'
  if (n > 1) return `Due in ${n} days`
  return n === -1 ? '1 day overdue' : `${-n} days overdue`
}

export type GoalStats = {
  total: number
  done: number
  percent: number // of the steps finished; a goal marked done is 100
  costTotal: number // cents, every step with a cost
  costDone: number // cents, the steps already finished
  costLeft: number
  minutesTotal: number
  minutesDone: number
  minutesLeft: number
  overdue: number // steps not finished whose day has passed
  nextDue?: string // the soonest deadline among the unfinished steps
  late: boolean // the goal's own deadline has passed and it is not done
}

export function goalStats(goal: Goal, today: string): GoalStats {
  const tasks = goal.tasks
  const finished = tasks.filter((t) => t.done)
  const sum = (list: GoalTask[], pick: (t: GoalTask) => number | undefined) => list.reduce((s, t) => s + (pick(t) ?? 0), 0)
  const costTotal = sum(tasks, (t) => t.costCents)
  const costDone = sum(finished, (t) => t.costCents)
  const minutesTotal = sum(tasks, (t) => t.minutes)
  const minutesDone = sum(finished, (t) => t.minutes)
  const open = tasks.filter((t) => !t.done)
  const days = open.flatMap((t) => (t.dueDate ? [t.dueDate] : [])).sort()
  return {
    total: tasks.length,
    done: finished.length,
    percent: goal.status === 'done' ? 100 : tasks.length === 0 ? 0 : Math.round((finished.length / tasks.length) * 100),
    costTotal,
    costDone,
    costLeft: costTotal - costDone,
    minutesTotal,
    minutesDone,
    minutesLeft: minutesTotal - minutesDone,
    overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
    nextDue: days[0],
    late: goal.status !== 'done' && !!goal.dueDate && goal.dueDate < today,
  }
}

/** Anything that doesn't add up, in words, so the person can fix the plan. */
export function goalWarnings(goal: Goal, stats: GoalStats): string[] {
  const out: string[] = []
  if (goal.budgetCents !== undefined && stats.costTotal > goal.budgetCents) out.push('The steps cost more than the budget.')
  if (goal.budgetMinutes !== undefined && stats.minutesTotal > goal.budgetMinutes) out.push('The steps take more time than planned.')
  const after = goal.dueDate ? goal.tasks.filter((t) => !t.done && t.dueDate && t.dueDate > goal.dueDate!).length : 0
  if (after > 0) out.push(after === 1 ? "A step is due after the goal's deadline." : `${after} steps are due after the goal's deadline.`)
  return out
}

/** Unfinished steps first, soonest deadline first (no deadline last), then the finished ones. */
export const orderedSteps = (tasks: GoalTask[]) =>
  [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
  })

/** Soonest deadline first (no deadline last). */
export const orderedGoals = (goals: Goal[]) => [...goals].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))

/* ---------- Reading and writing time and money ---------- */

/** "90", "45m", "1.5h", "1h 30m", "2 hr", "1:30" are minutes. Empty is none (null). Anything else is undefined. */
export function parseMinutes(text: string): number | null | undefined {
  const s = text.trim().toLowerCase()
  if (s === '') return null
  const clock = /^(\d+):(\d{1,2})$/.exec(s)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const plain = /^(\d+)$/.exec(s)
  if (plain) return Number(plain[1])
  const parts = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(s)
  if (!parts || (parts[1] === undefined && parts[2] === undefined)) return undefined
  return Math.round(Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0))
}

/** 45 is "45m", 120 is "2h", 90 is "1h 30m". */
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "$1,200", "12.50", "80" are cents. Empty is none (null). Anything else is undefined. */
export function parseDollars(text: string): number | null | undefined {
  const s = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (s === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined
  return Math.round(Number(s) * 100)
}

/** What goes back into a money box when editing: 12000 is "120", 1250 is "12.50". */
export const dollarsForInput = (cents: number | undefined) =>
  cents === undefined ? '' : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)

export const minutesForInput = (minutes: number | undefined) => (minutes === undefined ? '' : formatMinutes(minutes))