import { useSyncExternalStore, type ReactNode } from 'react'
import type { PanelSize } from '../types'

/** A panel a page has put on show, so other places (the Dashboard) can show the very same panel. */
export type PublishedPanel = { page: string; id: string; title: string; size: PanelSize; node: ReactNode }

// Pages publish their panels here every time they draw, and the Dashboard reads them. A panel is the
// page's own live element (it uses the page's data and handlers), so a change in one place shows in the other.
const pages = new Map<string, PublishedPanel[]>() // a Map keeps pages in the order they first appeared
let snapshot: PublishedPanel[] = []
const listeners = new Set<() => void>()

const refresh = () => {
  snapshot = [...pages.values()].flat()
  listeners.forEach((l) => l())
}

export function publishPanels(page: string, panels: PublishedPanel[]) {
  pages.set(page, panels)
  refresh()
}

export function unpublishPage(page: string) {
  if (pages.delete(page)) refresh()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const usePublishedPanels = () => useSyncExternalStore(subscribe, () => snapshot)
/** What a page's filter icon needs from its Board: the panels and whether each is on show, and a way to choose. */
export type BoardControl = {
  panels: { id: string; title: string; hidden: boolean }[]
  setShown: (ids: string[]) => void
}

const boards = new Map<string, BoardControl>()
let boardsSnapshot: ReadonlyMap<string, BoardControl> = boards
const boardListeners = new Set<() => void>()

export function registerBoard(page: string, control: BoardControl) {
  boards.set(page, control)
  boardsSnapshot = new Map(boards) // a new object, so subscribers notice the change
  boardListeners.forEach((l) => l())
}

export function unregisterBoard(page: string) {
  if (boards.delete(page)) {
    boardsSnapshot = new Map(boards)
    boardListeners.forEach((l) => l())
  }
}

const subscribeBoards = (listener: () => void) => {
  boardListeners.add(listener)
  return () => {
    boardListeners.delete(listener)
  }
}

export const useBoardControl = (page: string) => useSyncExternalStore(subscribeBoards, () => boardsSnapshot).get(page)