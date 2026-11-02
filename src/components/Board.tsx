import { Children, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { PanelSize, PanelState } from '../types'
import { moveBeside, moveToEnd, stretched, type Frame } from './boardMath'
import { publishPanels, registerBoard, unpublishPage, unregisterBoard } from './panelStore'
import { useBoardLayout } from './useBoardLayout'

type PanelProps = {
  /** Stays the same for good: the saved layout remembers the panel by it. */
  id: string
  title: string
  /** How wide it starts out. */
  size?: PanelSize
  /** Starts out put away (until the person adds it), instead of on show. */
  defaultHidden?: boolean
  children: ReactNode
}

/** One movable piece of a page. Put these inside a Board. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Panel(_props: PanelProps): null {
  return null
}

/** The sides and corners a panel can be stretched by (the compass points of each). The width is a third, a half or all of it; the height is never less than the contents need. */
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** Whatever a click or press on should do its own job, not select or move the panel. */
const OWN_JOB = 'a, button, input, select, textarea, label, summary, [role="button"], [draggable="true"], .board-controls, .board-edge'

const SAVE_TEXT = {
  idle: '',
  saving: 'Saving layout…',
  saved: 'Layout saved',
  error: "Couldn't save the layout to your account. It is kept in this browser.",
}

/**
 * Lays out its Panels in a grid. The person can press a panel and drag it anywhere, pull its sides or corners to
 * make it a third, a half or the full width and a little taller, and put some away. The settings gear's Customize layout lists them all.
 * The arrangement is saved for the page.
 */
export default function Board({
  page,
  editing,
  onEditingChange,
  publish = true,
  emptyText = 'Every panel is put away. Open the settings gear and choose Customize layout to bring them back.',
  children,
}: {
  page: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Offer these panels to the Dashboard. Off for the Dashboard's own board. */
  publish?: boolean
  /** Shown when no panel is on show. */
  emptyText?: string
  children: ReactNode
}) {
  const panels = Children.toArray(children).filter(
    (c): c is ReactElement<PanelProps> => isValidElement(c) && c.type === Panel,
  )
  const byId = new Map(panels.map((p) => [p.props.id, p.props]))
  const defaults: PanelState[] = panels.map((p) => ({
    id: p.props.id,
    size: p.props.size ?? 'full',
    hidden: p.props.defaultHidden ?? false,
  }))

  // Offer every panel to the Dashboard, as it is drawn right now (so it stays live), and take them back on leaving.
  useEffect(() => {
    if (!publish) return
    publishPanels(
      page,
      panels.map((p) => ({ page, id: p.props.id, title: p.props.title, size: p.props.size ?? 'full', node: p.props.children })),
    )
  })
  useEffect(
    () => () => {
      unpublishPage(page)
      unregisterBoard(page)
    },
    [page],
  )

  const { layout, set, reset, state } = useBoardLayout(page, defaults)
  const [dragId, setDragId] = useState<string | null>(null)
  // Where a dragged panel would land: beside this one, before or after it, in a row (`vertical` false) or in a column.
  const [over, setOver] = useState<{ id: string; after: boolean; vertical: boolean } | null>(null)
  // A panel the person has clicked. Its controls stay on show (the others show theirs while the pointer is over them).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A panel being stretched by some of its edges: where it stood at the start, and what it would be now.
  const [resize, setResize] = useState<{ id: string; edges: string; frame: Frame; size: PanelSize; height?: number; natural: number } | null>(null)

  const present = layout.filter((l) => byId.has(l.id))
  const shown = present.filter((l) => !l.hidden)
  const away = present.filter((l) => l.hidden)

  // Lets the page's filter icon choose which panels are on show.
  useEffect(() => {
    registerBoard(page, {
      panels: present.map((l) => ({ id: l.id, title: byId.get(l.id)?.title ?? l.id, hidden: l.hidden })),
      setShown: (ids) => set(layout.map((l) => (byId.has(l.id) ? { ...l, hidden: !ids.includes(l.id) } : l))),
    })
  })

  // Clicking anywhere else, or pressing Escape, lets go of the selected panel.
  useEffect(() => {
    if (!selectedId) return
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.board-item.selected')) setSelectedId(null)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [selectedId])

  const change = (id: string, patch: Partial<PanelState>) => set(layout.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const moveTo = (from: string, to: string, after = false) => {
    const next = moveBeside(layout, from, to, after)
    if (next !== layout) set(next)
  }

  const moveBy = (id: string, delta: number) => {
    const at = shown.findIndex((l) => l.id === id)
    const neighbor = shown[at + delta]
    if (neighbor) moveTo(id, neighbor.id, delta > 0)
  }

  const endDrag = () => {
    setDragId(null)
    setOver(null)
  }

  // Clicking text or empty space in a panel selects it. Clicking a button, field or link does what it is for.
  const selectOnClick = (id: string, e: React.MouseEvent) => {
    if (editing || (e.target instanceof Element && e.target.closest(OWN_JOB))) return
    setSelectedId((cur) => (cur === id ? null : id))
  }

  return (
    <>
      {(editing || state !== 'idle') && (
      <div className="board-toolbar row">
        <span className="muted board-status" role="status">
          {state === 'error' ? SAVE_TEXT.error : editing && state === 'idle' ? 'Drag a panel to move it, or pull its sides to make it wider, narrower or taller.' : SAVE_TEXT[state]}
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
        {editing && (
          <button className="primary" onClick={() => onEditingChange(false)}>
            Done
          </button>
        )}
      </div>
      )}

      {shown.length === 0 && <p className="empty">{emptyText}</p>}

      <div className={`board ${editing ? 'editing' : ''} ${dragId ? 'dragging-any' : ''}`}>
        {shown.map((item) => {
          const panel = byId.get(item.id)!
          const stretching = resize?.id === item.id
          const size = stretching ? resize.size : item.size
          const height = stretching ? resize.height : item.height
          const target = over && dragId && dragId !== item.id && over.id === item.id ? over : null
          const classes = [
            'board-item',
            size,
            height ? 'tall' : '',
            dragId === item.id ? 'dragging' : '',
            selectedId === item.id && !editing ? 'selected' : '',
            stretching ? 'resizing' : '',
            target ? `drop-${target.after ? 'after' : 'before'}-${target.vertical ? 'y' : 'x'}` : '',
          ]
          const startDrag = (e: React.DragEvent) => {
            setDragId(item.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', item.id)
            e.dataTransfer.setDragImage(e.currentTarget, 24, 16)
          }
          // The panel can be picked up by any part that has no job of its own (text, empty space, its heading).
          const arm = (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0 || (e.target instanceof Element && e.target.closest(OWN_JOB))) return
            e.currentTarget.draggable = true
          }
          const disarm = (e: React.SyntheticEvent<HTMLDivElement>) => {
            e.currentTarget.draggable = false
          }
          const arrowKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.target !== e.currentTarget) return // keys typed into something inside the panel are theirs
            if (e.key === 'Enter' && !editing) {
              e.preventDefault()
              setSelectedId((cur) => (cur === item.id ? null : item.id))
              return
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
              e.preventDefault()
              moveBy(item.id, -1)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
              e.preventDefault()
              moveBy(item.id, 1)
            }
          }
          return (
            <div
              key={item.id}
              className={classes.filter(Boolean).join(' ')}
              style={height ? { minHeight: height } : undefined}
              tabIndex={0}
              aria-label={`${panel.title}. Drag to move it, or use the arrow keys.`}
              onPointerDown={arm}
              onPointerUp={disarm}
              onDragStart={startDrag}
              onDragEnd={(e) => {
                disarm(e)
                endDrag()
              }}
              onKeyDown={arrowKeys}
              onClick={(e) => selectOnClick(item.id, e)}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                // Beside it, on the side the pointer is nearer: left or right in a row, above or below when it fills the width.
                const box = e.currentTarget.getBoundingClientRect()
                const board = e.currentTarget.parentElement?.getBoundingClientRect()
                const vertical = !board || box.width > board.width * 0.9
                const after = vertical ? e.clientY > box.top + box.height / 2 : e.clientX > box.left + box.width / 2
                if (over?.id !== item.id || over.after !== after || over.vertical !== vertical) setOver({ id: item.id, after, vertical })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && over && over.id === item.id) moveTo(dragId, item.id, over.after)
                endDrag()
              }}
            >
              {editing ? (
                <div className="board-bar">
                  <strong className="board-bar-title">{panel.title}</strong>
                  <button
                    className="link"
                    onClick={() => change(item.id, { hidden: true })}
                    aria-label={`Put ${panel.title} away`}
                    title="Put away (bring it back with Add panel)"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              ) : (
                // Without customizing: this shows once the panel is clicked, low inside it.
                <div className="board-controls">
                  <button
                    className="link"
                    onClick={() => change(item.id, { hidden: true })}
                    aria-label={`Put ${panel.title} away`}
                    title="Put away (bring it back from the filter icon)"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              )}
              <div className="board-content">{panel.children}</div>
              {EDGES.map((edges) => (
                <span
                  key={edges}
                  className={`board-edge edge-${edges}`}
                  role="separator"
                  aria-label={`Resize ${panel.title} from its ${edges}`}
                  title={edges === 'n' || edges === 's' ? 'Drag to make it taller (double-click for its natural height)' : 'Drag to resize'}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const el = e.currentTarget.closest<HTMLElement>('.board-item')
                    const board = e.currentTarget.closest('.board')?.getBoundingClientRect()
                    if (!el || !board) return
                    // How tall it is with nothing stretched: take its minimum height off for a moment and look.
                    const kept = el.style.minHeight
                    el.style.minHeight = '0'
                    const natural = el.getBoundingClientRect().height
                    el.style.minHeight = kept
                    const box = el.getBoundingClientRect()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setSelectedId(item.id)
                    setResize({
                      id: item.id,
                      edges,
                      frame: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, total: board.width },
                      size: item.size,
                      height: item.height,
                      natural,
                    })
                  }}
                  onPointerMove={(e) => {
                    if (resize?.id !== item.id || resize.edges !== edges) return
                    const next = stretched(edges, resize.frame, e.clientX, e.clientY, resize.natural)
                    const size = next.size ?? resize.size
                    const height = edges.includes('n') || edges.includes('s') ? next.height : resize.height
                    if (size !== resize.size || height !== resize.height) setResize({ ...resize, size, height })
                  }}
                  onPointerUp={() => {
                    if (resize?.id !== item.id || resize.edges !== edges) return
                    if (resize.size !== item.size || resize.height !== item.height) change(item.id, { size: resize.size, height: resize.height })
                    setResize(null)
                  }}
                  onPointerCancel={() => setResize(null)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if ((edges === 'n' || edges === 's') && item.height) change(item.id, { height: undefined })
                  }}

                />
              ))}
            </div>
          )
        })}
      </div>

      {/* While dragging, a place after the last panel to let go. */}
      {dragId && (
        <div
          className="board-dropzone"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const next = moveToEnd(layout, dragId)
            if (next !== layout) set(next)
            endDrag()
          }}
        >
          Drop here to put it last
        </div>
      )}
    </>
  )
}
