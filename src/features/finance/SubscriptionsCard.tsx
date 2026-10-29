import { useEffect, useState } from 'react'
import { subscriptionsApi } from '../../lib/api'
import { formatDay, formatMoney } from '../../lib/dates'
import type { Subscription, SubscriptionData } from '../../types'

type Props = {
  /** Changes whenever the transactions do, so this list is looked at again. */
  reload: number
  /** Limits the list to the accounts in the active view. */
  inView: (account: string) => boolean
  /** Names of accounts that are credit cards, to tag them. */
  creditAccounts: Set<string>
  onError: (message: string) => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** Repeating charges found in your spending, grouped by the card or account they are charged to. */
export default function SubscriptionsCard({ reload, inView, creditAccounts, onError }: Props) {
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [showEnded, setShowEnded] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    subscriptionsApi
      .list()
      .then((d) => !cancelled && setData(d))
      .catch(() => {}) // a nice-to-have, so it stays quiet when it can't load
    return () => {
      cancelled = true
    }
  }, [reload, refresh])

  if (!data) return null

  const mark = async (account: string, name: string, status: 'subscription' | 'not' | 'clear') => {
    try {
      await subscriptionsApi.mark(account, name, status)
      setRefresh((n) => n + 1)
    } catch (err) {
      onError(errorText(err))
    }
  }

  const here = data.items.filter((s) => inView(s.account))
  const active = here.filter((s) => s.active)
  const ended = here.filter((s) => !s.active)
  const ignored = data.ignored.filter((i) => inView(i.account))
  const candidates = data.candidates.filter((c) => inView(c.account))

  const byAccount = new Map<string, Subscription[]>()
  for (const s of showEnded ? here : active) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s])
  const monthly = active.reduce((sum, s) => sum + s.monthlyCents, 0)

  const query = search.trim().toLowerCase()
  const matches = query ? candidates.filter((c) => c.name.toLowerCase().includes(query) || c.account.toLowerCase().includes(query)).slice(0, 8) : []

  return (
    <section className="card">
      <div className="row between">
        <h2>Subscriptions</h2>
        <div className="stat-value bad">{formatMoney(monthly)}/mo</div>
      </div>
      <p className="stat-label" style={{ marginTop: 0 }}>
        {active.length === 0
          ? 'None found yet.'
          : `${active.length} repeating ${active.length === 1 ? 'charge' : 'charges'}, about ${formatMoney(monthly * 12)} a year.`}{' '}
        Found when a merchant charges an account once a month for at least 3 months in a row. Anything else, search below to mark it by hand.
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
              <li key={`${s.account}:${s.key}`} style={s.active ? undefined : { opacity: 0.6 }}>
                <span>
                  {s.name}
                  {s.marked && (
                    <span className="pill" style={{ marginLeft: 8 }}>
                      Marked by you
                    </span>
                  )}
                  <br />
                  <span className="stat-label">
                    {s.cadence}
                    {s.varies && ' · amount varies'} · {s.count} {s.count === 1 ? 'charge' : 'charges'} · last {formatDay(s.lastDate)}
                    {s.active ? ` · next about ${formatDay(s.nextDate)}` : ' · looks cancelled'}
                  </span>
                </span>
                <span className="row">
                  <strong className="bad">
                    {s.varies && '~'}-{formatMoney(s.amountCents)}
                    {s.varies && '/mo'}
                  </strong>
                  {s.marked ? (
                    <button className="link" onClick={() => mark(s.account, s.name, 'clear')} title="Take back your mark. It stays only if it is found automatically.">
                      Unmark
                    </button>
                  ) : (
                    <button className="link" onClick={() => mark(s.account, s.name, 'not')} title="Remove this from Subscriptions">
                      Not a subscription
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <input
          placeholder="Mark something as a subscription: search your charges (AWS, Printful...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search charges to mark as a subscription"
          style={{ width: '100%' }}
        />
        {query && matches.length === 0 && <p className="stat-label">No other charges match "{search.trim()}".</p>}
        {matches.length > 0 && (
          <ul className="list">
            {matches.map((c) => (
              <li key={`${c.account}:${c.key}`}>
                <span>
                  {c.name}
                  <br />
                  <span className="stat-label">
                    {c.account} · {c.count} {c.count === 1 ? 'charge' : 'charges'} · last {formatMoney(c.lastAmountCents)} on {formatDay(c.lastDate)}
                  </span>
                </span>
                <button
                  onClick={async () => {
                    await mark(c.account, c.name, 'subscription')
                    setSearch('')
                  }}
                >
                  Mark as subscription
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {ended.length > 0 && (
          <button className="link" onClick={() => setShowEnded((v) => !v)} aria-expanded={showEnded}>
            {showEnded ? 'Hide' : 'Show'} ones that look cancelled ({ended.length})
          </button>
        )}
        {ignored.length > 0 && (
          <button className="link" onClick={() => setShowIgnored((v) => !v)} aria-expanded={showIgnored}>
            {showIgnored ? 'Hide' : 'Show'} ones you said are not subscriptions ({ignored.length})
          </button>
        )}
      </div>
      {showIgnored && (
        <ul className="list">
          {ignored.map((i) => (
            <li key={`${i.account}:${i.key}`} style={{ opacity: 0.7 }}>
              <span>
                {i.name}
                <br />
                <span className="stat-label">{i.account}</span>
              </span>
              <button className="link" onClick={() => mark(i.account, i.name, 'clear')}>
                Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
