import { useState } from 'react'
import { viewsApi } from '../../lib/api'
import type { AccountView } from '../../types'

export type AccountChoice = { name: string; tag: string | null }

type Props = {
  views: AccountView[]
  activeId: string | null
  onSelect: (id: string | null) => void
  /** Every account that can be put in a view. */
  choices: AccountChoice[]
  onSaved: (view: AccountView) => void
  onDeleted: (id: string) => void
  onError: (message: string) => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** Pick a saved view (like Business or Personal), or create and edit them. */
export default function ViewsBar({ views, activeId, onSelect, choices, onSaved, onDeleted, onError }: Props) {
  // null = closed, 'new' = creating, otherwise the id of the view being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const active = views.find((v) => v.id === activeId) ?? null

  const open = (view: AccountView | null) => {
    setEditing(view ? view.id : 'new')
    setName(view?.name ?? '')
    setPicked(new Set(view?.accounts ?? []))
  }

  const toggle = (accountName: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(accountName)) next.delete(accountName)
      else next.add(accountName)
      return next
    })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return onError('Give the view a name.')
    if (views.some((v) => v.id !== editing && v.name.toLowerCase() === trimmed.toLowerCase())) {
      return onError(`You already have a view named ${trimmed}.`)
    }
    // Keep accounts that are no longer listed (a bank that is out of sync, say) so they aren't silently dropped.
    const accounts = [...picked]
    try {
      const saved = editing === 'new' ? await viewsApi.create({ name: trimmed, accounts }) : await viewsApi.update(editing!, { name: trimmed, accounts })
      onSaved(saved)
      onSelect(saved.id)
      setEditing(null)
    } catch (err) {
      onError(errorText(err))
    }
  }

  const remove = async () => {
    const target = views.find((v) => v.id === editing)
    if (!target) return
    if (!window.confirm(`Delete the view "${target.name}"? Your accounts and transactions are not affected.`)) return
    try {
      await viewsApi.remove(target.id)
      onDeleted(target.id)
      if (activeId === target.id) onSelect(null)
      setEditing(null)
    } catch (err) {
      onError(errorText(err))
    }
  }

  const stale = [...picked].filter((p) => !choices.some((c) => c.name === p))

  return (
    <section className="card">
      <div className="row between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <strong>View</strong>
          <div className="segmented" role="group" aria-label="Saved views">
            <button className={!active ? 'active' : ''} aria-pressed={!active} onClick={() => (setEditing(null), onSelect(null))}>
              All accounts
            </button>
            {views.map((v) => (
              <button key={v.id} className={active?.id === v.id ? 'active' : ''} aria-pressed={active?.id === v.id} onClick={() => (setEditing(null), onSelect(v.id))}>
                {v.name}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          {active && editing === null && (
            <button className="link" onClick={() => open(active)}>
              Edit "{active.name}"
            </button>
          )}
          {editing === null && <button onClick={() => open(null)}>New view</button>}
        </div>
      </div>

      {editing !== null && (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          <div className="form">
            <input placeholder="View name, like Business" value={name} onChange={(e) => setName(e.target.value)} aria-label="View name" autoFocus maxLength={100} />
          </div>
          <p className="stat-label" style={{ marginBottom: 4 }}>
            Choose which accounts belong in this view.
          </p>
          {choices.length === 0 && <p className="empty">No accounts yet. Connect a bank or add one by hand first.</p>}
          <ul className="list">
            {choices.map((c) => (
              <li key={c.name}>
                <label className="row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(c.name)} onChange={() => toggle(c.name)} />
                  <span>
                    {c.name}
                    {c.tag && (
                      <span className="pill" style={{ marginLeft: 8 }}>
                        {c.tag}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {stale.length > 0 && (
            <p className="stat-label">
              Also kept: {stale.join(', ')} (not listed right now).
            </p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" type="submit">
              Save view
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing !== 'new' && (
              <button type="button" className="link" onClick={remove}>
                Delete view
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
