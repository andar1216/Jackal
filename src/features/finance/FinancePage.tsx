import { useEffect, useState } from 'react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns'
import { accountsApi, plaidApi, TRANSACTIONS_CHANGED, transactionsApi, viewsApi } from '../../lib/api'
import { formatDay, formatMoney, toDateKey, todayKey } from '../../lib/dates'
import type { AccountView, BankAccount, ManualAccount, Transaction } from '../../types'
import NetWorthCard from './NetWorthCard'
import ViewsBar, { type AccountChoice } from './ViewsBar'

const BUDGETS: Record<string, number> = {
  Food: 40000,
  Rent: 120000,
  Transport: 15000,
  Fun: 20000,
  Other: 10000,
}
const CATEGORIES = Object.keys(BUDGETS)

const VIEW_KEY = 'jackal.finance.view'
const BY_HAND = 'Added by hand'
/** The name an account added by hand goes by on this page. */
const manualLabel = (a: ManualAccount) => (a.mask ? `${a.name} ••${a.mask}` : a.name)
const accountOf = (t: Transaction) => t.accountName ?? BY_HAND

/** What a transaction does to spending: a refund on a credit card counts as negative spending. */
const spend = (t: Transaction) => (t.type !== 'expense' ? 0 : t.isRefund ? -t.amountCents : t.amountCents)

type AccountKind = 'bank' | 'credit' | 'hand'
type KindFilter = 'all' | 'bank' | 'credit'

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bank', label: 'Bank accounts' },
  { id: 'credit', label: 'Credit cards' },
]
const KIND_LABELS: Record<AccountKind, string | null> = { bank: 'Bank account', credit: 'Credit card', hand: null }

type AccountRow = { name: string; kind: AccountKind; spent: number; income: number; count: number }

/** One row per account. Accounts we know about are listed even when they had nothing this month. */
function groupByAccount(items: Transaction[], known: BankAccount[]) {
  const groups = new Map<string, AccountRow>()
  const row = (name: string) => {
    const g = groups.get(name) ?? { name, kind: name === BY_HAND ? ('hand' as const) : ('bank' as const), spent: 0, income: 0, count: 0 }
    groups.set(name, g)
    return g
  }
  for (const a of known) row(a.label).kind = a.type === 'credit' ? 'credit' : 'bank'
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
  const [manualAccounts, setManualAccounts] = useState<ManualAccount[]>([])
  const [views, setViews] = useState<AccountView[]>([])
  // Remembered between visits, so Finances opens on the view you were last using.
  const [viewId, setViewId] = useState<string | null>(() => localStorage.getItem(VIEW_KEY))
  const chooseView = (id: string | null) => {
    setViewId(id)
    setAccount(null)
    if (id) localStorage.setItem(VIEW_KEY, id)
    else localStorage.removeItem(VIEW_KEY)
  }
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<ManualAccount['kind']>('credit')
  const [newMask, setNewMask] = useState('')
  const [newBalance, setNewBalance] = useState('')

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
    accountsApi
      .list()
      .then((list) => !cancelled && setManualAccounts(list))
      .catch(() => {})
    viewsApi
      .list()
      .then((list) => !cancelled && setViews(list))
      .catch(() => {})
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
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  // Accounts typed in by hand sit alongside the ones from Plaid.
  const handAccounts: BankAccount[] = manualAccounts.map((a) => ({
    label: manualLabel(a),
    institution: a.name,
    type: a.kind === 'credit' ? 'credit' : 'depository',
  }))

  // A saved view (like Business) narrows everything on the page to its accounts.
  const view = views.find((v) => v.id === viewId) ?? null
  const inView = (name: string) => !view || view.accounts.includes(name)
  const viewChoices: AccountChoice[] = [
    ...bankAccounts.map((a) => ({ name: a.label, tag: a.type === 'credit' ? 'Credit card' : 'Bank account' })),
    ...handAccounts.map((a) => ({ name: a.label, tag: a.type === 'credit' ? 'Credit card' : 'Bank account' })),
    { name: BY_HAND, tag: null },
  ]
  const scoped = transactions.filter((t) => inView(accountOf(t)))
  const allAccounts = groupByAccount(
    scoped,
    [...bankAccounts, ...handAccounts].filter((a) => inView(a.label)),
  )
  const kindByName = new Map(allAccounts.map((a) => [a.name, a.kind]))
  // "Bank accounts" and "Credit cards" narrow both the account list and everything below it.
  const byAccount = kindFilter === 'all' ? allAccounts : allAccounts.filter((a) => a.kind === kindFilter)
  const activeAccount = byAccount.some((a) => a.name === account) ? account : null
  const shown = scoped.filter(
    (t) =>
      (kindFilter === 'all' || kindByName.get(accountOf(t)) === kindFilter) && (!activeAccount || accountOf(t) === activeAccount),
  )

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

  const addAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      const balance = Math.round(parseFloat(newBalance) * 100)
      const created = await accountsApi.create({
        name,
        kind: newKind,
        mask: newMask.trim() || undefined,
        balanceCents: Number.isFinite(balance) ? balance : undefined,
      })
      setManualAccounts((list) => [...list, created])
      setNewName('')
      setNewMask('')
      setNewBalance('')
      setAdding(false)
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
        <ViewsBar
          views={views}
          activeId={view?.id ?? null}
          onSelect={chooseView}
          choices={viewChoices}
          onSaved={(saved) => setViews((list) => (list.some((v) => v.id === saved.id) ? list.map((v) => (v.id === saved.id ? saved : v)) : [...list, saved]))}
          onDeleted={(id) => setViews((list) => list.filter((v) => v.id !== id))}
          onError={setError}
        />

        <NetWorthCard
          title={view ? `Net worth · ${view.name}` : 'Net worth'}
          plaid={bankAccounts.filter((a) => inView(a.label))}
          manual={manualAccounts.filter((a) => inView(manualLabel(a)))}
          onManualChange={(updated) => setManualAccounts((list) => list.map((a) => (a.id === updated.id ? updated : a)))}
          onError={setError}
        />

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

        {(allAccounts.length > 0 || adding || transactions.length === 0) && (
          <section className="card">
            <div className="row between">
              <h2>By account</h2>
              <div className="row">
                {activeAccount && (
                  <button className="link" onClick={() => setAccount(null)}>
                    Show all accounts
                  </button>
                )}
                <div className="segmented" role="group" aria-label="Account type">
                  {KIND_FILTERS.map((k) => (
                    <button
                      key={k.id}
                      className={kindFilter === k.id ? 'active' : ''}
                      aria-pressed={kindFilter === k.id}
                      onClick={() => setKindFilter(k.id)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
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
                        {KIND_LABELS[a.kind] && (
                          <span className="pill" style={{ marginLeft: 8 }}>
                            {KIND_LABELS[a.kind]}
                          </span>
                        )}
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
            {adding ? (
              <form className="form" onSubmit={addAccount} style={{ marginTop: 12 }}>
                <input placeholder="Name, like Citi Pay Credit" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Account name" autoFocus />
                <select value={newKind} onChange={(e) => setNewKind(e.target.value as ManualAccount['kind'])} aria-label="Account type">
                  <option value="credit">Credit card</option>
                  <option value="bank">Bank account</option>
                </select>
                <input placeholder="Last digits (optional)" inputMode="numeric" value={newMask} onChange={(e) => setNewMask(e.target.value)} aria-label="Last digits" />
                <input
                  type="number"
                  step="0.01"
                  placeholder={newKind === 'credit' ? 'Amount owed (optional)' : 'Balance (optional)'}
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  aria-label="Balance"
                />
                <button className="primary" type="submit">
                  Add account
                </button>
                <button type="button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <p className="stat-label" style={{ marginBottom: 0 }}>
                Missing an account? Open Connect, choose Add a bank, and tick every account in Plaid's list (or use
                Sync banks if a bank is still loading). Can't link one yet?{' '}
                <button className="link" onClick={() => setAdding(true)}>
                  Add it by hand
                </button>
              </p>
            )}
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
