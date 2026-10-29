import { useEffect, useState } from 'react'
import { subscriptionsApi } from '../../lib/api'
import { formatDay, formatMoney } from '../../lib/dates'
import type { Subscription } from '../../types'

type Props = {
  /** Changes whenever the transactions do, so this list is looked at again. */
  reload: number
  /** Limits the list to the accounts in the active view. */
  inView: (account: string) => boolean
  /** Names of accounts that are credit cards, to tag them. */
  creditAccounts: Set<string>
}

/** Repeating charges found in your spending, grouped by the card or account they are charged to. */
export default function SubscriptionsCard({ reload, inView, creditAccounts }: Props) {
  const [items, setItems] = useState<Subscription[] | null>(null)
  const [showEnded, setShowEnded] = useState(false)

  useEffect(() => {
    let cancelled = false
    subscriptionsApi
      .list()
      .then((list) => !cancelled && setItems(list))
      .catch(() => {}) // a nice-to-have, so it stays quiet when it can't load
    return () => {
      cancelled = true
    }
  }, [reload])

  if (!items) return null

  const here = items.filter((s) => inView(s.account))
  const active = here.filter((s) => s.active)
  const ended = here.filter((s) => !s.active)
  if (here.length === 0) return null

  const byAccount = new Map<string, Subscription[]>()
  for (const s of showEnded ? here : active) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s])
  const monthly = active.reduce((sum, s) => sum + s.monthlyCents, 0)

  return (
    <section className="card">
      <div className="row between">
        <h2>Subscriptions</h2>
        <div className="stat-value bad">{formatMoney(monthly)}/mo</div>
      </div>
      <p className="stat-label" style={{ marginTop: 0 }}>
        {active.length} repeating {active.length === 1 ? 'charge' : 'charges'} found in your last year of spending, about{' '}
        {formatMoney(monthly * 12)} a year. Based on the same merchant charging a similar amount on a regular schedule.
      </p>

      {[...byAccount.entries()].map(([account, subs]) => (
        <div key={account}>
          <div className="row" style={{ marginTop: 12 }}>
            <strong>{account}</strong>
            <span className="pill">{creditAccounts.has(account) ? 'Credit card' : 'Account'}</span>
            <span className="stat-label">{formatMoney(subs.filter((s) => s.active).reduce((n, s) => n + s.monthlyCents, 0))}/mo</span>
          </div>
          <ul className="list">
            {subs.map((s) => (
              <li key={`${s.account}:${s.name}`} style={s.active ? undefined : { opacity: 0.6 }}>
                <span>
                  {s.name}
                  <br />
                  <span className="stat-label">
                    {s.cadence} · {s.count} charges · last {formatDay(s.lastDate)}
                    {s.active ? ` · next about ${formatDay(s.nextDate)}` : ' · looks cancelled'}
                  </span>
                </span>
                <strong className="bad">-{formatMoney(s.amountCents)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {ended.length > 0 && (
        <button className="link" onClick={() => setShowEnded((v) => !v)} aria-expanded={showEnded}>
          {showEnded ? 'Hide' : 'Show'} ones that look cancelled ({ended.length})
        </button>
      )}
    </section>
  )
}
