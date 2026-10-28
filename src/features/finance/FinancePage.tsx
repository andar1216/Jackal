import { useEffect, useState } from 'react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns'
import { plaidApi, TRANSACTIONS_CHANGED, transactionsApi } from '../../lib/api'
import { formatDay, formatMoney, toDateKey, todayKey } from '../../lib/dates'
import type { Transaction } from '../../types'

const BUDGETS: Record<string, number> = {
  Food: 40000,
  Rent: 120000,
  Transport: 15000,
  Fun: 20000,
  Other: 10000,
}
const CATEGORIES = Object.keys(BUDGETS)

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export default function FinancePage() {
  // The page shows one month at a time, so the budgets mean something.
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const from = toDateKey(month)
  const to = toDateKey(endOfMonth(month))

  const [data, setData] = useState<{ key: string; items: Transaction[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const [type, setType] = useState<Transaction['type']>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    transactionsApi
      .list(from, to)
      .then((items) => {
        if (cancelled) return
        setData({ key: from, items })
        setError(null)
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [from, to, reload])

  // Refresh after a bank is connected, synced or disconnected from the Connect dialog.
  useEffect(() => {
    const refresh = () => setReload((n) => n + 1)
    window.addEventListener(TRANSACTIONS_CHANGED, refresh)
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, refresh)
  }, [])

  const loaded = data?.key === from
  const transactions = loaded ? data.items : []
  const isCurrentMonth = isSameMonth(month, new Date())

  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0)
  const spent = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0)
  const net = income - spent

  const spentBy = (cat: string) =>
    transactions
      .filter((t) => t.type === 'expense' && t.category === cat)
      .reduce((s, t) => s + t.amountCents, 0)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return
    try {
      const created = await transactionsApi.create({
        type,
        amountCents: cents,
        category,
        date: isCurrentMonth ? todayKey() : from,
        note: note.trim() || undefined,
      })
      setData((d) => (d ? { ...d, items: [...d.items, created] } : d))
      setAmount('')
      setNote('')
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const syncBanks = async () => {
    setSyncing(true)
    try {
      await plaidApi.sync()
      setError(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSyncing(false)
    }
  }
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Finances</h1>
          <p>Income, spending, and budgets.</p>
        </div>
        <div className="row">
          <button aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
            ‹
          </button>
          <strong>{format(month, 'MMMM yyyy')}</strong>
          <button aria-label="Next month" disabled={isCurrentMonth} onClick={() => setMonth((m) => addMonths(m, 1))}>
            ›
          </button>
          <button onClick={syncBanks} disabled={syncing} title="Fetch the latest transactions from your connected banks">
            {syncing ? 'Syncing...' : 'Sync banks'}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button onClick={() => setReload((n) => n + 1)}>Retry</button>
        </div>
      )}

      <div className="stack">
        <div className="grid cols-3">
          <div className="card">
            <div className="stat-label">Income</div>
            <div className="stat-value good">{formatMoney(income)}</div>
          </div>
          <div className="card">
            <div className="stat-label">Spent</div>
            <div className="stat-value bad">{formatMoney(spent)}</div>
          </div>
          <div className="card">
            <div className="stat-label">Net</div>
            <div className={`stat-value ${net >= 0 ? 'good' : 'bad'}`}>{formatMoney(net)}</div>
          </div>
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>Budgets</h2>
            <div className="stack" style={{ gap: 12 }}>
              {CATEGORIES.map((cat) => {
                const s = spentBy(cat)
                const budget = BUDGETS[cat]
                return (
                  <div key={cat}>
                    <div className="row between">
                      <span>{cat}</span>
                      <span className="muted">
                        {formatMoney(s)} / {formatMoney(budget)}
                      </span>
                    </div>
                    <div className={`bar ${s > budget ? 'over' : ''}`}>
                      <span style={{ width: `${Math.min(100, (s / budget) * 100)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card">
            <h2>Add transaction</h2>
            <form className="form" onSubmit={add}>
              <select value={type} onChange={(e) => setType(e.target.value as Transaction['type'])}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Amount"
              />
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="primary" type="submit">
                Add
              </button>
            </form>

            {!loaded && !error && <p className="empty">Loading...</p>}
            {loaded && sorted.length === 0 && <p className="empty">Nothing this month yet.</p>}
            <ul className="list">
              {sorted.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.note ?? t.category}
                    <br />
                    <span className="stat-label">
                      {t.category} · {formatDay(t.date)}
                      {t.source === 'plaid' && ` · ${t.accountName ?? 'Bank'}`}
                    </span>
                  </span>
                  <span className="row">
                    <strong className={t.type === 'income' ? 'good' : 'bad'}>
                      {t.type === 'income' ? '+' : '-'}
                      {formatMoney(t.amountCents)}
                    </strong>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
