import { Globe, Monitor, Smartphone } from 'lucide-react'
import type { AppCategoryEntry, ScreenTimeSite, ScreenTimeUsage } from '../../types'
import { MAX_DAYS, MAX_ITEMS, amountOf, useAmount, useChoice } from './amount'
import AmountSelect from './AmountSelect'
import { CATEGORIES, makeCategorizer } from './categories'
import ItemIcon from './ItemIcon'
import { appName, formatSeconds, topApps, topSites } from './screenTimeStats'

const COUNTS = [
  { value: '3', label: 'Top 3' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '20', label: 'Top 20' },
  { value: 'all', label: 'All' },
]
const PERIODS = [
  { value: '1', label: 'Today' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
]

const SHOW = ['all', 'apps', 'sites'] as const
const SHOW_LABELS: Record<(typeof SHOW)[number], string> = { all: 'Apps and websites', apps: 'Apps', sites: 'Websites' }
const GROUPS = ['items', 'categories'] as const
const GROUP_LABELS: Record<(typeof GROUPS)[number], string> = { items: 'By item', categories: 'By category' }

type Row = { key: string; type: 'app' | 'site'; device: 'computer' | 'phone'; name: string; label: string; seconds: number }

/**
 * One table of what takes your time: apps on the computer and phone, and websites, together. It can be limited to apps or
 * websites, and grouped by category. Each row has its category, which can be changed there.
 */
export default function MostUsedTable({
  usage,
  sites,
  categories,
  neverSent,
  onCategory,
}: {
  usage: ScreenTimeUsage[]
  sites: ScreenTimeSite[]
  categories: AppCategoryEntry[]
  neverSent: boolean
  onCategory: (kind: 'app' | 'site', name: string, category: string | null) => void
}) {
  const [count, setCount] = useAmount('used-count', '10', COUNTS, { start: 15, max: MAX_ITEMS })
  const [period, setPeriod] = useAmount('used-period', '1', PERIODS, { start: 14, max: MAX_DAYS })
  const [show, setShow] = useChoice('used-show', 'all', SHOW)
  const [group, setGroup] = useChoice('used-group', 'items', GROUPS)

  const days = amountOf(period)
  const categoryOf = makeCategorizer(categories)

  const appRows: Row[] = topApps(usage, days).map((a) => ({
    key: `app:${a.kind}:${a.app}`,
    type: 'app',
    device: a.kind,
    name: a.app,
    label: a.kind === 'phone' ? a.app : appName(a.app),
    seconds: a.seconds,
  }))
  const siteRows: Row[] = topSites(sites, days).map((s) => ({ key: `site:${s.site}`, type: 'site', device: 'computer', name: s.site, label: s.site, seconds: s.seconds }))
  const all = [...(show === 'sites' ? [] : appRows), ...(show === 'apps' ? [] : siteRows)].sort((a, b) => b.seconds - a.seconds)

  // Browsers show up twice on the computer: as an app, and as every website visited in them. Totals by category count the
  // websites, so browser time is not counted twice (when there are no websites, the browser keeps its own time).
  const countedByCategory = all.filter((r) => !(r.type === 'app' && r.device === 'computer' && siteRows.length > 0 && show === 'all' && categoryOf('app', r.name).category === 'Browsers'))
  const byCategory = new Map<string, { seconds: number; items: number }>()
  for (const r of countedByCategory) {
    const category = categoryOf(r.type, r.name).category
    const line = byCategory.get(category) ?? { seconds: 0, items: 0 }
    line.seconds += r.seconds
    line.items += 1
    byCategory.set(category, line)
  }
  const categoryRows = [...byCategory.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.seconds - a.seconds)

  const limit = amountOf(count)
  const items = all.slice(0, limit)
  const itemsTotal = items.reduce((s, r) => s + r.seconds, 0)
  const shownCategories = categoryRows.slice(0, limit)
  const categoriesTotal = shownCategories.reduce((s, r) => s + r.seconds, 0)

  // The categories a person has made themselves are offered along with the usual ones.
  const offered = [...new Set([...CATEGORIES, ...categories.flatMap((c) => (c.mine ? [c.mine] : []))])]

  const pick = (row: Row, value: string) => {
    if (value === '') return onCategory(row.type, row.name, null)
    if (value === '__new') {
      const made = window.prompt('Name for the new category')?.trim()
      if (made) onCategory(row.type, row.name, made.slice(0, 40))
      return
    }
    onCategory(row.type, row.name, value)
  }

  const picker = (row: Row) => {
    const current = categoryOf(row.type, row.name)
    return (
      <select
        className="category-select"
        aria-label={`Category of ${row.label}`}
        value={current.source === 'mine' ? current.category : ''}
        onChange={(e) => pick(row, e.target.value)}
      >
        <option value="">{current.source === 'mine' ? 'Automatic' : `${current.category}${current.source === 'none' ? '' : ' (auto)'}`}</option>
        {offered.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="__new">New category…</option>
      </select>
    )
  }

  const empty =
    all.length === 0
      ? neverSent
        ? 'Connect ActivityWatch or pair your phone to see which apps and websites take your time.'
        : 'Nothing counted for this period yet.'
      : null

  return (
    <section className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2>Most used</h2>
        <span className="row" style={{ flexWrap: 'wrap' }}>
          <select aria-label="What to list" value={show} onChange={(e) => setShow(e.target.value as (typeof SHOW)[number])}>
            {SHOW.map((s) => (
              <option key={s} value={s}>
                {SHOW_LABELS[s]}
              </option>
            ))}
          </select>
          <span className="segmented" role="group" aria-label="Grouping">
            {GROUPS.map((g) => (
              <button key={g} className={group === g ? 'active' : ''} aria-pressed={group === g} onClick={() => setGroup(g)}>
                {GROUP_LABELS[g]}
              </button>
            ))}
          </span>
          <AmountSelect label={group === 'items' ? 'Rows to show' : 'Categories to show'} options={COUNTS} amount={count} onChange={setCount} unit="rows" max={MAX_ITEMS} />
          <AmountSelect label="Period" options={PERIODS} amount={period} onChange={setPeriod} unit="days" max={MAX_DAYS} />
        </span>
      </div>

      {empty ? (
        <p className="empty">{empty}</p>
      ) : group === 'items' ? (
        <ul className="list">
          {items.map((r) => (
            <li key={r.key}>
              <ItemIcon kind={r.type} name={r.name} label={r.label} source={r.device === 'phone' ? 'phone' : undefined} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {r.label}
                {r.type === 'site' ? (
                  <Globe size={13} aria-label="Website" style={{ marginLeft: 6, verticalAlign: '-2px', opacity: 0.6 }} />
                ) : r.device === 'phone' ? (
                  <Smartphone size={13} aria-label="On your phone" style={{ marginLeft: 6, verticalAlign: '-2px', opacity: 0.6 }} />
                ) : (
                  <Monitor size={13} aria-label="On your computer" style={{ marginLeft: 6, verticalAlign: '-2px', opacity: 0.6 }} />
                )}
                <div className="bar">
                  <span style={{ width: `${(r.seconds / itemsTotal) * 100}%` }} />
                </div>
              </span>
              {picker(r)}
              <strong>{formatSeconds(r.seconds)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="list">
            {shownCategories.map((c) => (
              <li key={c.category}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {c.category}
                  <span className="stat-label" style={{ marginLeft: 8 }}>
                    {c.items} {c.items === 1 ? 'item' : 'items'}
                  </span>
                  <div className="bar">
                    <span style={{ width: `${(c.seconds / categoriesTotal) * 100}%` }} />
                  </div>
                </span>
                <strong>{formatSeconds(c.seconds)}</strong>
              </li>
            ))}
          </ul>
          {countedByCategory.length < all.length && <p className="stat-label">Browser time on the computer is counted by the websites visited in it.</p>}
        </>
      )}
    </section>
  )
}
