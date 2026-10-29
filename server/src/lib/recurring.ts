/**
 * Finds subscriptions and other repeating charges on each account.
 *
 * A charge is found automatically when the same merchant charges the same account exactly once
 * in each of at least 3 months in a row. The amount can differ each time (a cloud bill, say).
 * A merchant charged several times in a month (a store, a coffee shop) is a habit, not a subscription.
 * Anything else, like a yearly fee, can be marked as a subscription by the person, who can also say
 * that something found is not one.
 */

export type Charge = { note?: string | null; amountCents: number; date: string; accountName?: string | null }

export type Cadence = 'weekly' | 'every 2 weeks' | 'monthly' | 'quarterly' | 'yearly'

export type Mark = 'subscription' | 'not'

export type Recurring = {
  name: string
  account: string
  key: string // what the merchant is matched on, so it can be marked
  amountCents: number // the latest charge, or the average per month when the amount varies
  cadence: Cadence
  monthlyCents: number // what it costs per month on average, for adding things up
  lastDate: string
  nextDate: string
  count: number
  /** The amount is different each time, so the price shown is an average. */
  varies: boolean
  /** The person marked it as a subscription (instead of it being found automatically). */
  marked: boolean
  /** False when the charges stopped, so it may have been cancelled. */
  active: boolean
}

/** A merchant on an account that could be marked as a subscription. */
export type Candidate = { name: string; account: string; key: string; count: number; lastDate: string; lastAmountCents: number }

export type Detection = {
  items: Recurring[]
  /** Ones the person said are not subscriptions, so they can be put back. */
  ignored: { name: string; account: string; key: string }[]
  /** Everything else that was charged, to pick from when marking one by hand. */
  candidates: Candidate[]
}

type CadenceDef = { name: Cadence; min: number; max: number; perYear: number; days?: number; months?: number }

// How many days between charges counts as each schedule, and how many of them fit in a year.
const CADENCES: CadenceDef[] = [
  { name: 'weekly', min: 6, max: 8, perYear: 52, days: 7 },
  { name: 'every 2 weeks', min: 13, max: 16, perYear: 26, days: 14 },
  { name: 'monthly', min: 26, max: 35, perYear: 12, months: 1 },
  { name: 'quarterly', min: 84, max: 98, perYear: 4, months: 3 },
  { name: 'yearly', min: 350, max: 380, perYear: 1, months: 12 },
]
const MONTHLY = CADENCES[2]

/** How many months in a row, each with a single charge, it takes to count as a subscription. */
const MIN_MONTHS_IN_A_ROW = 3
const MAX_CANDIDATES = 500

const DAY_MS = 86_400_000
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
const dayToDate = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const monthIndex = (date: string) => {
  const [y, m] = date.split('-').map(Number)
  return y * 12 + (m - 1)
}

/** The same day of the month, some months later (the 31st becomes the month's last day when it has to). */
const addMonths = (date: string, months: number) => {
  const [y, m, d] = date.split('-').map(Number)
  const lastDayOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDayOfTarget))).toISOString().slice(0, 10)
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The same merchant is written many ways ("NETFLIX.COM 866-579-7172", "Netflix.com 800..."), so
 * compare only the first few words and ignore anything containing digits.
 */
export const merchantKey = (note?: string | null) =>
  (note ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !/\d/.test(word))
    .slice(0, 3)
    .join(' ')

export const markId = (account: string, key: string) => `${account}\u0000${key}`

const share = (values: number[], fits: (v: number) => boolean) => values.filter(fits).length / values.length

/** The schedule these charges follow, if the gaps between them are regular enough. */
function steadyCadence(days: number[]): CadenceDef | null {
  if (days.length < 2) return null
  const gaps = days.slice(1).map((d, i) => d - days[i])
  const typicalGap = median(gaps)
  const cadence = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max)
  if (!cadence) return null
  // Two charges prove little, except a year apart. Everything else needs at least three.
  if (days.length < 3 && cadence.name !== 'yearly') return null
  // Most gaps must fit the schedule, so one skipped month is forgiven but random dates are not.
  return share(gaps, (g) => g >= cadence.min && g <= cadence.max) >= 0.7 ? cadence : null
}

/** The price may creep up a little, but a charge that varies a lot is not a fixed price. */
function steadyAmount(amounts: number[]) {
  const typical = median(amounts)
  return share(amounts, (a) => Math.abs(a - typical) <= Math.max(typical * 0.15, 200)) >= 0.75
}

/** Charged exactly once in each of at least 3 calendar months that follow one another. */
function hasMonthlyRun(dates: string[]) {
  const perMonth = new Map<number, number>()
  for (const d of dates) perMonth.set(monthIndex(d), (perMonth.get(monthIndex(d)) ?? 0) + 1)
  const onceMonths = [...perMonth.entries()].filter(([, n]) => n === 1).map(([m]) => m).sort((a, b) => a - b)
  let run = 1
  for (let i = 1; i < onceMonths.length; i++) {
    run = onceMonths[i] - onceMonths[i - 1] === 1 ? run + 1 : 1
    if (run >= MIN_MONTHS_IN_A_ROW) return true
  }
  return false
}

/** Average of what was charged in each of the last few months it was charged. */
function averageMonthly(sorted: Charge[]) {
  const totals = new Map<number, number>()
  for (const c of sorted) totals.set(monthIndex(c.date), (totals.get(monthIndex(c.date)) ?? 0) + c.amountCents)
  const recent = [...totals.entries()].sort((a, b) => b[0] - a[0]).slice(0, 3)
  return Math.round(recent.reduce((sum, [, cents]) => sum + cents, 0) / recent.length)
}

function buildItem(sorted: Charge[], cadence: CadenceDef, varies: boolean, marked: boolean, today: string): Recurring {
  const last = sorted[sorted.length - 1]
  const account = last.accountName || 'Added by hand'
  const monthlyCents = varies && cadence.name === 'monthly' ? averageMonthly(sorted) : Math.round((last.amountCents * cadence.perYear) / 12)
  return {
    name: (last.note ?? '').trim().slice(0, 100) || 'Charge',
    account,
    key: merchantKey(last.note),
    amountCents: varies ? monthlyCents : last.amountCents,
    cadence: cadence.name,
    monthlyCents,
    lastDate: last.date,
    nextDate: cadence.months ? addMonths(last.date, cadence.months) : dayToDate(dayNumber(last.date) + (cadence.days ?? 7)),
    count: sorted.length,
    varies,
    marked,
    active: dayNumber(today) - dayNumber(last.date) <= cadence.max * 1.5,
  }
}

export function detectRecurring(charges: Charge[], today: string, marks: Map<string, Mark> = new Map(), markNames: Map<string, string> = new Map()): Detection {
  const groups = new Map<string, Charge[]>()
  for (const c of charges) {
    const key = merchantKey(c.note)
    if (!key) continue
    const id = markId(c.accountName || 'Added by hand', key)
    groups.set(id, [...(groups.get(id) ?? []), c])
  }

  const items: Recurring[] = []
  const ignored: Detection['ignored'] = []
  const candidates: Candidate[] = []

  for (const [id, group] of groups) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date))
    const last = sorted[sorted.length - 1]
    const account = last.accountName || 'Added by hand'
    const key = merchantKey(last.note)
    const mark = marks.get(id)

    if (mark === 'not') {
      ignored.push({ name: markNames.get(id) ?? (last.note ?? '').trim().slice(0, 100), account, key })
      continue
    }

    const days = sorted.map((c) => dayNumber(c.date))
    const amountsSteady = steadyAmount(sorted.map((c) => c.amountCents))
    const schedule = steadyCadence(days)

    let found: Recurring | null = null
    if (mark === 'subscription') {
      found = buildItem(sorted, schedule ?? MONTHLY, !amountsSteady, true, today)
    } else if (hasMonthlyRun(sorted.map((c) => c.date))) {
      found = buildItem(sorted, MONTHLY, !amountsSteady, false, today)
    }

    if (found) items.push(found)
    else candidates.push({ name: (last.note ?? '').trim().slice(0, 100), account, key, count: sorted.length, lastDate: last.date, lastAmountCents: last.amountCents })
  }

  items.sort((a, b) => a.account.localeCompare(b.account) || b.monthlyCents - a.monthlyCents)
  candidates.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count)
  return { items, ignored, candidates: candidates.slice(0, MAX_CANDIDATES) }
}
