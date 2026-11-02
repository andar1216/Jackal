/**
 * Reading the file Strong makes with Settings > Export Strong Data. It is a table with one row per set:
 * Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE.
 * Versions of the app differ a little (the separator, units in the heading, how the duration is written), so
 * headings are matched by name and the separator is worked out from the first line.
 */

export type StrongSet = { weight?: number; reps?: number; seconds?: number; distance?: number }
export type StrongExercise = { name: string; sets: StrongSet[] }
export type StrongWorkout = {
  /** Stays the same for the same workout every time the file is read. */
  externalId: string
  date: string // YYYY-MM-DD
  type: string
  durationMin: number
  unit?: 'kg' | 'lb'
  exercises: StrongExercise[]
}

export class StrongFileError extends Error {}

/** Splits text into rows of fields. Fields may be in quotes (which can hold the separator, quotes and line breaks). */
export function parseTable(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === separator) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** The separator the first line uses, outside quotes: a comma, a semicolon or a tab. */
function separatorOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]])
  let quoted = false
  for (const c of first) {
    if (c === '"') quoted = !quoted
    else if (!quoted && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** A heading made plain: "Weight (kg)" and "weight" both become "weight". */
const heading = (h: string) => h.replace(/\(.*?\)/g, '').trim().toLowerCase()

const number = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined
  const s = v.trim()
  if (s === '') return undefined
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s)
  return Number.isFinite(n) ? n : undefined
}

/** How long, in seconds, from "1h 5m 30s", "45m", "2h" or a plain number (seconds, unless the heading says minutes). */
export function durationSeconds(value: string, headingText = ''): number {
  const v = value.trim().toLowerCase()
  if (v === '') return 0
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * (/min/.test(headingText.toLowerCase()) ? 60 : 1)
  let total = 0
  for (const [, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) total += Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
  return total
}

/** The workouts in an export, oldest first. */
export function parseStrong(input: string): StrongWorkout[] {
  const text = input.replace(/^\uFEFF/, '')
  const table = parseTable(text, separatorOf(text))
  if (table.length < 2) throw new StrongFileError("That doesn't look like a Strong export: it has no workouts in it.")

  const rawHeadings = table[0]
  const at = (name: string) => rawHeadings.findIndex((h) => heading(h) === name)
  const col = {
    date: at('date'),
    workout: at('workout name'),
    duration: at('duration'),
    exercise: at('exercise name'),
    order: at('set order'),
    weight: at('weight'),
    reps: at('reps'),
    distance: at('distance'),
    seconds: at('seconds'),
  }
  if (col.date < 0 || col.workout < 0 || col.exercise < 0) {
    throw new StrongFileError("That doesn't look like a Strong export: it needs Date, Workout Name and Exercise Name columns.")
  }
  const unitText = rawHeadings[col.weight] ?? ''
  const unit = /\bkg\b/i.test(unitText) ? 'kg' : /\blbs?\b/i.test(unitText) ? 'lb' : undefined

  const workouts = new Map<string, StrongWorkout>()
  for (const row of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
    const when = cell(col.date)
    const date = when.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (/rest/i.test(cell(col.order))) continue // the rest timers some versions list as rows of their own

    const type = cell(col.workout) || 'Workout'
    const key = `${when}|${type}`
    let workout = workouts.get(key)
    if (!workout) {
      const seconds = durationSeconds(cell(col.duration), rawHeadings[col.duration] ?? '')
      workout = { externalId: key, date, type, durationMin: Math.max(1, Math.round(seconds / 60)), ...(unit ? { unit } : {}), exercises: [] }
      workouts.set(key, workout)
    }
    const name = cell(col.exercise)
    if (!name) continue
    let exercise = workout.exercises.find((e) => e.name === name)
    if (!exercise) {
      exercise = { name, sets: [] }
      workout.exercises.push(exercise)
    }
    const set: StrongSet = {}
    for (const [field, index] of [['weight', col.weight], ['reps', col.reps], ['seconds', col.seconds], ['distance', col.distance]] as const) {
      const n = number(cell(index))
      if (n !== undefined && n !== 0) set[field] = n
    }
    exercise.sets.push(set)
  }
  return [...workouts.values()].sort((a, b) => a.externalId.localeCompare(b.externalId))
}
