import { useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'
import { useDismiss } from './useDismiss'

export type FilterOption = { id: string; label: string; color?: string }

/**
 * A filter icon whose dropdown picks which of `options` to show: all, some, or none.
 * `selected` holds the ids being shown.
 */
export default function FilterMenu({
  label,
  heading,
  options,
  selected,
  onChange,
}: {
  label: string
  heading: string
  options: FilterOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useDismiss(open, box, () => setOpen(false))

  const chosen = new Set(selected)
  const count = options.filter((o) => chosen.has(o.id)).length
  const filtered = count !== options.length // something is left out

  const toggle = (id: string) => onChange(options.filter((o) => (o.id === id ? !chosen.has(id) : chosen.has(o.id))).map((o) => o.id))

  return (
    <span className="menu" ref={box}>
      <button
        className="link menu-trigger filter-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: showing ${count} of ${options.length}`}
        title={`${label} (${count} of ${options.length} shown)`}
        onClick={() => setOpen((o) => !o)}
      >
        <ListFilter size={18} />
        {filtered && <span className="filter-count">{count}</span>}
      </button>
      {open && (
        <div className="menu-list filter-list" role="dialog" aria-label={heading}>
          <div className="row between filter-head">
            <strong>{heading}</strong>
            <span className="row" style={{ gap: 4 }}>
              <button className="link" onClick={() => onChange(options.map((o) => o.id))} disabled={count === options.length}>
                All
              </button>
              <button className="link" onClick={() => onChange([])} disabled={count === 0}>
                None
              </button>
            </span>
          </div>
          {options.length === 0 && <p className="stat-label">Nothing to filter yet.</p>}
          {options.map((o) => (
            <label key={o.id} className="filter-option">
              <input type="checkbox" checked={chosen.has(o.id)} onChange={() => toggle(o.id)} />
              {o.color && <span className="swatch" style={{ background: o.color }} />}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </span>
  )
}