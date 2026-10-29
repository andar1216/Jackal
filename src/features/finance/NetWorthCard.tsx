import { useState } from 'react'
import { accountsApi } from '../../lib/api'
import { formatMoney } from '../../lib/dates'
import type { BankAccount, ManualAccount } from '../../types'

type Row = {
  key: string
  name: string
  /** Debts (credit cards and loans) count against net worth. Everything else counts for it. */
  debt: boolean
  tag: string
  balanceCents?: number
  manual?: ManualAccount
}

const plaidRow = (a: BankAccount): Row => {
  const debt = a.type === 'credit' || a.type === 'loan'
  const tag = a.type === 'credit' ? 'Credit card' : a.type === 'loan' ? 'Loan' : a.type === 'investment' ? 'Investment' : 'Bank account'
  return { key: `plaid:${a.label}`, name: a.label, debt, tag, balanceCents: a.balanceCents }
}

const manualRow = (m: ManualAccount): Row => ({
  key: `hand:${m.id}`,
  name: m.mask ? `${m.name} ••${m.mask}` : m.name,
  debt: m.kind === 'credit',
  tag: m.kind === 'credit' ? 'Credit card' : 'Bank account',
  balanceCents: m.balanceCents,
  manual: m,
})

/** A balance typed in by hand. For a card, enter what is owed. */
function BalanceEditor({ account, onSaved, onError }: { account: ManualAccount; onSaved: (a: ManualAccount) => void; onError: (message: string) => void }) {
  const [value, setValue] = useState(account.balanceCents === undefined ? '' : (account.balanceCents / 100).toFixed(2))
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const cents = Math.round(parseFloat(value) * 100)
    if (!Number.isFinite(cents)) return
    try {
      onSaved(await accountsApi.update(account.id, { balanceCents: cents }))
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }
  return (
    <form className="row" onSubmit={save}>
      <input
        type="number"
        step="0.01"
        placeholder={account.kind === 'credit' ? 'Amount owed' : 'Balance'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Balance for ${account.name}`}
        style={{ width: 120 }}
      />
      <button type="submit">Save</button>
    </form>
  )
}

type Props = {
  plaid: BankAccount[]
  manual: ManualAccount[]
  onManualChange: (account: ManualAccount) => void
  onError: (message: string) => void
}

/**
 * What you own minus what you owe, from each account's latest balance. Balances come from the
 * last bank sync (Sync banks refreshes them), or are typed in for accounts added by hand.
 */
export default function NetWorthCard({ plaid, manual, onManualChange, onError }: Props) {
  const rows = [...plaid.map(plaidRow), ...manual.map(manualRow)].sort(
    (a, b) => Number(a.debt) - Number(b.debt) || a.name.localeCompare(b.name),
  )
  if (rows.length === 0) return null

  const counted = rows.filter((r) => r.balanceCents !== undefined)
  const assets = counted.filter((r) => !r.debt).reduce((s, r) => s + (r.balanceCents ?? 0), 0)
  const debts = counted.filter((r) => r.debt).reduce((s, r) => s + (r.balanceCents ?? 0), 0)
  const net = assets - debts
  const missing = rows.length - counted.length

  return (
    <section className="card">
      <div className="row between">
        <h2>Net worth</h2>
        <div className={`stat-value ${net >= 0 ? 'good' : 'bad'}`}>{formatMoney(net)}</div>
      </div>
      <p className="stat-label" style={{ marginTop: 0 }}>
        Assets {formatMoney(assets)} · Debts {formatMoney(debts)} · from each account's latest balance
        {missing > 0 && ` (${missing} ${missing === 1 ? 'account has' : 'accounts have'} no balance yet, so ${missing === 1 ? 'it isn\'t' : 'they aren\'t'} counted)`}
      </p>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.key}>
            <span>
              {r.name}
              <span className="pill" style={{ marginLeft: 8 }}>
                {r.tag}
              </span>
            </span>
            <span className="row">
              {r.manual && <BalanceEditor key={`${r.manual.id}:${r.manual.balanceCents}`} account={r.manual} onSaved={onManualChange} onError={onError} />}
              {!r.manual &&
                (r.balanceCents === undefined ? (
                  <span className="muted">No balance yet</span>
                ) : r.debt ? (
                  <strong className="bad">{formatMoney(r.balanceCents)}</strong>
                ) : (
                  <strong className="good">{formatMoney(r.balanceCents)}</strong>
                ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
