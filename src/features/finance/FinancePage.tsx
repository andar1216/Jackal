import { useState } from 'react'
import { subDays } from 'date-fns'
import { formatDay, formatMoney, toDateKey, todayKey, uid } from '../../lib/dates'
import type { Transaction } from '../../types'

const BUDGETS: Record<string, number> = {
  Food: 40000,
  Rent: 120000,
  Transport: 15000,
  Fun: 20000,
  Other: 10000,
}
const CATEGORIES = Object.keys(BUDGETS)

const daysAgo = (n: number) => toDateKey(subDays(new Date(), n))

const SEED: Transaction[] = [
  { id: '1', type: 'income', amountCents: 320000, category: 'Other', date: daysAgo(3), note: 'Paycheck' },
  { id: '2', type: 'expense', amountCents: 120000, category: 'Rent', date: daysAgo(2), note: 'Monthly rent' },
  { id: '3', type: 'expense', amountCents: 8450, category: 'Food', date: daysAgo(1), note: 'Groceries' },
  { id: '4', type: 'expense', amountCents: 3200, category: 'Transport', date: daysAgo(1), note: 'Gas' },
  { id: '5', type: 'expense', amountCents: 5500, category: 'Fun', date: todayKey(), note: 'Movie night' },
]

export default function FinancePage() {
  const [transactions, setTransactions] = useState<Transaction[]>(SEED)
  const [type, setType] = useState<Transaction['type']>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [note, setNote] = useState('')

  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountCents, 0)
  const spent = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountCents, 0)
  const net = income - spent

  const spentBy = (cat: string) =>
    transactions
      .filter((t) => t.type === 'expense' && t.category === cat)
      .reduce((s, t) => s + t.amountCents, 0)

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return
    setTransactions((prev) => [
      { id: uid(), type, amountCents: cents, category, date: todayKey(), note: note.trim() || undefined },
      ...prev,
    ])
    setAmount('')
    setNote('')
  }

  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <header className="page-header">
        <h1>Finances</h1>
        <p>Income, spending, and budgets.</p>
      </header>

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

            <ul className="list">
              {sorted.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.note ?? t.category}
                    <br />
                    <span className="stat-label">
                      {t.category} · {formatDay(t.date)}
                    </span>
                  </span>
                  <span className="row">
                    <strong className={t.type === 'income' ? 'good' : 'bad'}>
                      {t.type === 'income' ? '+' : '-'}
                      {formatMoney(t.amountCents)}
                    </strong>
                    <button
                      className="link"
                      aria-label="Delete transaction"
                      onClick={() => setTransactions((p) => p.filter((x) => x.id !== t.id))}
                    >
                      ✕
                    </button>
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
