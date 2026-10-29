import { useRef, useState, type ReactNode } from 'react'
import { useDismiss } from './useDismiss'

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean }

/** A button ("⋯" unless given an icon) that opens a small dropdown of actions. */
export default function MenuButton({ label, items, icon }: { label: string; items: MenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useDismiss(open, box, () => setOpen(false))

  return (
    <span className="menu" ref={box}>
      <button className="link menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        {icon ?? '⋯'}
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                className={`link ${item.danger ? 'bad' : ''}`}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
