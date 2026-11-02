import type { PanelSize, PanelState } from '../types'

/**
 * Which width a panel being stretched snaps to, from how much of the board's width it covers (0 to 1).
 * The limits sit halfway between the sizes (a third, a half, three quarters, all of it), a little toward the larger one.
 */
export const sizeForWidth = (share: number): PanelSize => (share < 0.42 ? 'third' : share < 0.625 ? 'half' : share < 0.875 ? 'threeQuarters' : 'full')

/** Puts `from` just before `to` (or just after it, with `after`). Anything that can't be done leaves the layout as it was. */
export function moveBeside(layout: PanelState[], from: string, to: string, after: boolean): PanelState[] {
  if (from === to) return layout
  const item = layout.find((l) => l.id === from)
  const rest = layout.filter((l) => l.id !== from)
  const at = rest.findIndex((l) => l.id === to)
  if (!item || at < 0) return layout
  rest.splice(after ? at + 1 : at, 0, item)
  return rest.every((l, i) => l.id === layout[i].id) ? layout : rest
}

/** Puts `id` after the last panel on show, wherever it was. */
export function moveToEnd(layout: PanelState[], id: string): PanelState[] {
  const last = [...layout].reverse().find((l) => !l.hidden && l.id !== id)
  return last ? moveBeside(layout, id, last.id, true) : layout
}

/** Where a panel stood when its edge was picked up: its sides on the screen, and the board's width. */
export type Frame = { left: number; right: number; top: number; bottom: number; total: number }

/** A panel can only be made taller in steps this big (pixels), and never past this. */
export const HEIGHT_STEP = 40
export const MAX_HEIGHT = 1200

/**
 * What a panel becomes when the pointer, at (x, y), pulls some of its sides (any of the letters n, s, e, w).
 * The east or west side changes the width, which is always one of the three sizes. The north or south side
 * changes the height, which is never less than `natural` (what its contents need, so nothing is squeezed or
 * scrolls) and goes up in steps. A direction that isn't pulled isn't in the answer, and `height` is undefined
 * when the panel is back to its natural height.
 */
export function stretched(edges: string, frame: Frame, x: number, y: number, natural: number): { size?: PanelSize; height?: number | undefined } {
  const out: { size?: PanelSize; height?: number | undefined } = {}
  if (edges.includes('e')) out.size = sizeForWidth((x - frame.left) / frame.total)
  else if (edges.includes('w')) out.size = sizeForWidth((frame.right - x) / frame.total)
  const wanted = edges.includes('s') ? y - frame.top : edges.includes('n') ? frame.bottom - y : null
  if (wanted !== null) {
    const steps = Math.round((Math.min(MAX_HEIGHT, wanted) - natural) / HEIGHT_STEP)
    out.height = steps <= 0 ? undefined : Math.min(MAX_HEIGHT, Math.ceil(natural) + steps * HEIGHT_STEP)
  }
  return out
}