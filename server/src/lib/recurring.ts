/**
 * Finds subscriptions and other repeating charges: the same merchant, on the same account,
 * for about the same amount, again and again on a regular schedule.
 */

export type Charge = { note?: string | null; amountCents: number; date: string; accountName?: string | null }

export type Cadence = 'weekly' | 'every 2 weeks' | 'monthly' | 'quarterly' | 'yearly'

export type Recurring = {
  name: string
  account: string
  amountCents: number // the latest charge
  cadence: Cadence
  monthlyCents: number // what it costs per month on average, for adding things up
  lastDate: string
  nextDate: string
  count: number
  /** False when the charges stopped, so it may have been cancelled. */
  active: boolean
}

// How many days between charges counts as each schedule, and how many of them fit in a year.
const CADENCES: { name: Cadence; min: number; max: number; perYear: number; days?: number; months?: number }[] = [
  { name: 'weekly', min: 6, max: 8, perYear: 52, days: 7 },
  { name: 'every 2 weeks', min: 13, max: 16, perYear: 26, days: 14 },
  { name: 'monthly', min: 26, max: 35, perYear: 12, months: 1 },
  { name: 'quarterly', min: 84, max: 98, perYear: 4, months: 3 },
  { name: 'yearly', min: 350, max: 380, perYear: 1, months: 12 },
]

const DAY_MS = 86_400_000
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
const dayToDate = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

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
const merchantKey = (note?: string | null) =>
  (note ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !/\d/.test(word))
    .slice(0, 3)
    .join(' ')

const share = (values: number[], fits: (v: number) => boolean) => values.filter(fits).length / values.length

export function detectRecurring(charges: Charge[], today: string): Recurring[] {
  const groups = new Map<string, Charge[]>()
  for (const c of charges) {
    const key = merchantKey(c.note)
    if (!key) continue
    const account = c.accountName || 'Added by hand'
    const id = `${account}\u0000${key}`
    groups.set(id, [...(groups.get(id) ?? []), c])
  }

  const found: Recurring[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date))
    if (sorted.length < 2) continue

    const days = sorted.map((c) => dayNumber(c.date))
    const gaps = days.slice(1).map((d, i) => d - days[i])
    const typicalGap = median(gaps)
    const cadence = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max)
    if (!cadence) continue
    // Two charges prove nothing, except a year apart. Everything else needs at least three.
    if (sorted.length < 3 && cadence.name !== 'yearly') continue
    // Most gaps must fit the schedule, so one skipped month is forgiven but random dates are not.
    if (share(gaps, (g) => g >= cadence.min && g <= cadence.max) < 0.7) continue

    // The price may creep up a little, but a charge that varies a lot is shopping, not a subscription.
    const amounts = sorted.map((c) => c.amountCents)
    const typical = median(amounts)
    if (share(amounts, (a) => Math.abs(a - typical) <= Math.max(typical * 0.15, 200)) < 0.75) continue

    const last = sorted[sorted.length - 1]
    const lastDay = days[days.length - 1]
    found.push({
      name: (last.note ?? '').trim().slice(0, 100) || 'Charge',
      account: last.accountName || 'Added by hand',
      amountCents: last.amountCents,
      cadence: cadence.name,
      monthlyCents: Math.round((last.amountCents * cadence.perYear) / 12),
      lastDate: last.date,
      nextDate: cadence.months ? addMonths(last.date, cadence.months) : dayToDate(lastDay + (cadence.days ?? 7)),
      count: sorted.length,
      active: dayNumber(today) - lastDay <= cadence.max * 1.5,
    })
  }

  return found.sort((a, b) => a.account.localeCompare(b.account) || b.monthlyCents - a.monthlyCents)
}
