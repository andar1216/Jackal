import { useEffect, useState } from 'react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns'
import { plaidApi, TRANSACTIONS_CHANGED, transactionsApi } from '../../lib/api'
import { formatDay, formatMoney, toDateKey, todayKey } from '../../lib/dates'
import type { BankAccount, Transaction } from '../../types'

const BUDGETS: Record<string, number> = {
  Food: 40000,
  Rent: 120000,
  Transport: 15000,
  Fun: 20000,
  Other: 10000,
}
const CATEGORIES = Object.keys(BUDGETS)

const BY_HAND = 'Added by hand'
const accountOf = (t: Transaction) => t.accountName ?? BY_HAND

/** What a transaction does to spending: a refund on a credit card counts as negative spending. */
const spend = (t: Transaction) => (t.type !== 'expense' ? 0 : t.isRefund ? -t.amountCents : t.amountCents)

type AccountRow = { name: string; isCredit: boolean; spent: number; income: number; count: number }

/** One row per account. Accounts we know about are listed even when they had nothing this month. */
function groupByAccount(items: Transaction[], known: BankAccount[]) {
  const groups = new Map<string, AccountRow>()
  const row = (name: string) => {
    const g = groups.get(name) ?? { name, isCredit: false, spent: 0, income: 0, count: 0 }
    groups.set(name, g)
    return g
  }
  for (const a of known) row(a.label).isCredit = a.type === 'credit'
  for (const t of items) {
    const g = row(accountOf(t))
    if (t.type === 'income') g.income += t.amountCents
    g.spent += spend(t)
    g.count++
  }
  // Busiest first, quiet accounts at the end.
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

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
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

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

  // Every account we know about, so one with no activity this month still shows up.
  useEffect(() => {
    let cancelled = false
    plaidApi
      .accounts()
      .then((list) => !cancelled && setBankAccounts(list))
      .catch(() => {}) // not essential, so a failure here is ignored
    return () => {
      cancelled = true
    }
  }, [reload])

  // Refresh after a bank is connected, synced or disconnected from the Connect dialog.
  useEffect(() => {
    const refresh = () => setReload((n) => n + 1)
    window.addEventListener(TRANSACTIONS_CHANGED, refresh)
    return () => window.removeEventListener(TRANSACTIONS_CHANGED, refresh)
  }, [])

  const loaded = data?.key === from
  const transactions = loaded ? data.items : []
  const isCurrentMonth = isSameMonth(month, new Date())

  // Group the month's transactions by the account they came from. Clicking an account filters everything below.
  const [account, setAccount] = useState<string | null>(null)
  const byAccount = groupByAccount(transactions, bankAccounts)
  const activeAccount = byAccount.some((a) => a.name === account) ? account : null
  const shown = activeAccount ? transactions.filter((t) => accountOf(t) === activeAccount) : transactions

  const income = shown.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0)
  const spent = shown.reduce((s, t) => s + spend(t), 0)
  const net = income - spent

  const spentBy = (cat: string) =>
    Math.max(0, shown.filter((t) => t.category === cat).reduce((s, t) => s + spend(t), 0))

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
      const result = await plaidApi.sync()
      // Say which bank had a problem, since the others still synced.
      setError(result.errors?.length ? result.errors.map((e) => `${e.institution}: ${e.message}`).join(' ') : null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSyncing(false)
    }
  }
  const sorted = [...shown].sort((a, b) => b.date.localeCompare(a.date))

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

        {byAccount.length > 0 && (
          <section className="card">
            <div className="row between">
              <h2>By account</h2>
              {activeAccount && (
                <button className="link" onClick={() => setAccount(null)}>
                  Show all accounts
                </button>
              )}
            </div>
            <ul className="list">
              {byAccount.map((a) => {
                const selected = a.name === activeAccount
                return (
                  <li key={a.name} className={`skill-row ${selected ? 'selected' : ''}`}>
                    <button
                      className="skill-name"
                      aria-pressed={selected}
                      title="Show only this account"
                      onClick={() => setAccount(selected ? null : a.name)}
                    >
                      <span>
                        {a.name}
                        {a.isCredit && <span className="pill"> Credit card</span>}
                        <span className="stat-label">
                          {' '}
                          · {a.count === 0 ? 'no activity this month' : `${a.count} ${a.count === 1 ? 'transaction' : 'transactions'}`}
                        </span>
                      </span>
                    </button>
                    <span className="row">
                      {a.income > 0 && <strong className="good">+{formatMoney(a.income)}</strong>}
                      {a.count === 0 ? (
                        <span className="muted">{formatMoney(0)}</span>
                      ) : a.spent < 0 ? (
                        <strong className="good">+{formatMoney(-a.spent)}</strong>
                      ) : (
                        a.spent > 0 && <strong className="bad">-{formatMoney(a.spent)}</strong>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="stat-label" style={{ marginBottom: 0 }}>
              Missing an account? Open Connect, choose Add a bank, and tick every account in Plaid's list (or use
              Sync banks if a bank is still loading).
            </p>
          </section>
        )}

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
                      {t.isRefund && ' · refund'}
                      {t.source === 'plaid' && ` · ${t.accountName ?? 'Bank'}`}
                    </span>
                  </span>
                  <span className="row">
                    <strong className={t.type === 'income' || t.isRefund ? 'good' : 'bad'}>
                      {t.type === 'income' || t.isRefund ? '+' : '-'}
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
