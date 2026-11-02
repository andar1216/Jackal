import { useState, type ReactNode } from 'react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { formatDay, formatMoney } from '../../lib/dates'
import { AVERAGE_WEEKS, checkInProgress } from './crunchStats'
import type { Crunch } from './useCrunch'

const PREVIEW = 10

function Status({ crunch }: { crunch: Crunch }) {
  const { data, syncing, error, sync } = crunch
  if (!data?.connected) return null
  const problem = error ?? data.lastError
  return (
    <div className="crunch-status">
      {problem && (
        <div className="banner error" role="alert">
          <span>{problem}</span>
        </div>
      )}
      <span className="stat-label">
        {data.lastSyncedAt ? `Synced ${formatDistanceToNow(parseISO(data.lastSyncedAt), { addSuffix: true })}` : 'Not synced yet'}
        {data.email ? ` · ${data.email}` : ''}
      </span>
      {data.autoSync === false ? (
        <>
          <span className="stat-label">· To refresh, click your "Send to Valkyrie" bookmark on the Crunch tab.</span>
          <a className="link" href="https://members.crunch.com/" target="_blank" rel="noopener noreferrer">
            Open Crunch ↗
          </a>
        </>
      ) : (
        <button className="link" disabled={syncing} onClick={() => void sync()}>
          {syncing ? 'Syncing...' : 'Sync now'}
        </button>
      )}
    </div>
  )
}

function Frame({ title, crunch, empty, children }: { title: string; crunch: Crunch; empty: string; children: ReactNode }) {
  const connected = crunch.data?.connected
  return (
    <section className="card">
      <h2>{title}</h2>
      {!crunch.data ? <p className="empty">Loading...</p> : !connected ? <p className="empty">{empty}</p> : children}
      <Status crunch={crunch} />
    </section>
  )
}

const NOT_CONNECTED = 'Connect Crunch with the Connectors button to see this.'

function MoreList<T>({ items, render, empty }: { items: T[]; render: (item: T) => ReactNode; empty: string }) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return <p className="empty">{empty}</p>
  const shown = all ? items : items.slice(0, PREVIEW)
  return (
    <>
      <ul className="list">{shown.map(render)}</ul>
      {items.length > PREVIEW && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  )
}

export function CheckInProgressPanel({ crunch }: { crunch: Crunch }) {
  const data = crunch.data
  const p = checkInProgress(data?.checkIns ?? [], data?.workoutGoal)
  const reached = p.goal !== undefined && p.thisWeek >= p.goal
  return (
    <Frame title="Club Check-In Progress" crunch={crunch} empty={NOT_CONNECTED}>
      <div className="stat-label">This week{p.goal ? ` (goal ${p.goal})` : ''}</div>
      <div className={`stat-value ${reached ? 'good' : ''}`}>{p.goal ? `${p.thisWeek} / ${p.goal}` : p.thisWeek}</div>
      {p.goal && (
        <div className="bar">
          <span style={{ width: `${Math.min(100, (p.thisWeek / p.goal) * 100)}%` }} />
        </div>
      )}
      <div className="row between" style={{ marginTop: 12 }}>
        <div>
          <div className="stat-label">Average per week</div>
          <strong>{p.average.toFixed(2)}</strong> <span className="stat-label">last {AVERAGE_WEEKS} weeks</span>
        </div>
        <div>
          <div className="stat-label">Best week</div>
          <strong>{p.best}</strong>
        </div>
      </div>
      <p className="stat-label">Check-ins can take 24 to 48 hours to show up on Crunch's side.</p>
    </Frame>
  )
}

export function CheckInHistoryPanel({ crunch }: { crunch: Crunch }) {
  return (
    <Frame title="Club Check-In History" crunch={crunch} empty={NOT_CONNECTED}>
      <MoreList
        items={crunch.data?.checkIns ?? []}
        empty="No check-ins yet."
        render={(c) => (
          <li key={c.id}>
            <span>
              {format(parseISO(c.at), 'EEE, MMM d, yyyy')}
              <br />
              <span className="stat-label">
                {format(parseISO(c.at), 'h:mm a')}
                {c.club ? ` · ${c.club}` : ''}
              </span>
            </span>
          </li>
        )}
      />
    </Frame>
  )
}

export function ClassHistoryPanel({ crunch }: { crunch: Crunch }) {
  return (
    <Frame title="Class History" crunch={crunch} empty={NOT_CONNECTED}>
      <MoreList
        items={crunch.data?.classes ?? []}
        empty="No classes yet."
        render={(c) => (
          <li key={c.id}>
            <span>
              {c.program}
              <br />
              <span className="stat-label">
                {format(parseISO(c.startsAt), 'EEE, MMM d, yyyy · h:mm a')}
                {c.club ? ` · ${c.club}` : ''}
              </span>
            </span>
            <span className="row">
              {c.feeCents ? <strong>{formatMoney(c.feeCents)}</strong> : null}
              <span className={`pill ${c.status.toLowerCase() === 'attended' ? 'good-pill' : ''}`}>{c.status}</span>
            </span>
          </li>
        )}
      />
    </Frame>
  )
}

export function PaymentHistoryPanel({ crunch }: { crunch: Crunch }) {
  const balance = crunch.data?.balanceCents
  return (
    <Frame title="Payment History" crunch={crunch} empty={NOT_CONNECTED}>
      {balance != null && (
        <p className="stat-label">
          Balance: <strong className={balance > 0 ? 'bad' : ''}>{formatMoney(balance)}</strong>
        </p>
      )}
      <MoreList
        items={crunch.data?.payments ?? []}
        empty="No payments yet."
        render={(p) => (
          <li key={p.id}>
            <span>
              {p.service}
              <br />
              <span className="stat-label">{formatDay(p.date)}</span>
            </span>
            <strong className={p.amountCents < 0 ? 'good' : ''}>{formatMoney(p.amountCents)}</strong>
          </li>
        )}
      />
    </Frame>
  )
}
