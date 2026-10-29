import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import type { PanelSize, PanelState } from '../types'
import { useBoardLayout } from './useBoardLayout'

type PanelProps = {
  /** Stays the same for good: the saved layout remembers the panel by it. */
  id: string
  title: string
  /** How wide it starts out. */
  size?: PanelSize
  children: ReactNode
}

/** One movable piece of a page. Put these inside a Board. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Panel(_props: PanelProps): null {
  return null
}

const SIZE_CHOICES: { id: PanelSize; label: string; title: string }[] = [
  { id: 'third', label: '1/3', title: 'A third of the width' },
  { id: 'half', label: '1/2', title: 'Half the width' },
  { id: 'full', label: 'Full', title: 'The full width' },
]

const SAVE_TEXT = {
  idle: '',
  saving: 'Saving layout…',
  saved: 'Layout saved',
  error: "Couldn't save the layout to your account. It is kept in this browser.",
}

/**
 * Lays out its Panels in a grid. "Customize layout" lets the person drag panels around,
 * make them wider or narrower, and put some away. The arrangement is saved for the page.
 */
export default function Board({ page, children }: { page: string; children: ReactNode }) {
  const panels = Children.toArray(children).filter(
    (c): c is ReactElement<PanelProps> => isValidElement(c) && c.type === Panel,
  )
  const byId = new Map(panels.map((p) => [p.props.id, p.props]))
  const defaults: PanelState[] = panels.map((p) => ({ id: p.props.id, size: p.props.size ?? 'full', hidden: false }))

  const { layout, set, reset, state } = useBoardLayout(page, defaults)
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const present = layout.filter((l) => byId.has(l.id))
  const shown = present.filter((l) => !l.hidden)
  const away = present.filter((l) => l.hidden)

  const change = (id: string, patch: Partial<PanelState>) => set(layout.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const moveTo = (from: string, to: string) => {
    const i = layout.findIndex((l) => l.id === from)
    const j = layout.findIndex((l) => l.id === to)
    if (i < 0 || j < 0 || i === j) return
    const next = [...layout]
    const [item] = next.splice(i, 1)
    next.splice(j, 0, item)
    set(next)
  }

  const moveBy = (id: string, delta: number) => {
    const at = shown.findIndex((l) => l.id === id)
    const neighbor = shown[at + delta]
    if (neighbor) moveTo(id, neighbor.id)
  }

  const endDrag = () => {
    setDragId(null)
    setOverId(null)
  }

  return (
    <>
      <div className="board-toolbar row">
        <span className="muted board-status" role="status">
          {state === 'error' ? SAVE_TEXT.error : editing && state === 'idle' ? 'Drag a panel by its handle, or focus it and use the arrow keys.' : SAVE_TEXT[state]}
        </span>
        {editing && away.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && change(e.target.value, { hidden: false })}
            aria-label="Add a panel back"
          >
            <option value="">+ Add panel</option>
            {away.map((l) => (
              <option key={l.id} value={l.id}>
                {byId.get(l.id)?.title}
              </option>
            ))}
          </select>
        )}
        {editing && (
          <button onClick={reset} title="Put every panel back where it started">
            Reset layout
          </button>
        )}
        <button className={editing ? 'primary' : ''} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Customize layout'}
        </button>
      </div>

      {shown.length === 0 && <p className="empty">Every panel is put away. Choose Customize layout to bring them back.</p>}

      <div className={`board ${editing ? 'editing' : ''}`}>
        {shown.map((item) => {
          const panel = byId.get(item.id)!
          const classes = [
            'board-item',
            item.size,
            dragId === item.id ? 'dragging' : '',
            overId === item.id && dragId && dragId !== item.id ? 'drop-target' : '',
          ]
          return (
            <div
              key={item.id}
              className={classes.filter(Boolean).join(' ')}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overId !== item.id) setOverId(item.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) moveTo(dragId, item.id)
                endDrag()
              }}
            >
              {editing && (
                <div
                  className="board-bar"
                  draggable
                  onDragStart={(e) => {
                    setDragId(item.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', item.id)
                    const el = e.currentTarget.closest('.board-item')
                    if (el) e.dataTransfer.setDragImage(el, 24, 16)
                  }}
                  onDragEnd={endDrag}
                >
                  <span
                    className="drag-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={`Move ${panel.title}. Use the arrow keys.`}
                    title="Drag to move (or focus and use the arrow keys)"
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                        e.preventDefault()
                        moveBy(item.id, -1)
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        moveBy(item.id, 1)
                      }
                    }}
                  >
                    ⠿
                  </span>
                  <strong className="board-bar-title">{panel.title}</strong>
                  <span className="board-bar-actions">
                    <span className="segmented" role="group" aria-label={`Width of ${panel.title}`}>
                      {SIZE_CHOICES.map((c) => (
                        <button
                          key={c.id}
                          className={item.size === c.id ? 'active' : ''}
                          aria-pressed={item.size === c.id}
                          title={c.title}
                          onClick={() => change(item.id, { size: c.id })}
                        >
                          {c.label}
                        </button>
                      ))}
                    </span>
                    <button
                      className="link"
                      onClick={() => change(item.id, { hidden: true })}
                      aria-label={`Put ${panel.title} away`}
                      title="Put away (bring it back with Add panel)"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )}
              <div className="board-content">{panel.children}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}
