import { useCallback, useEffect, useRef, useState } from 'react'
import { layoutsApi } from '../lib/api'
import type { PanelState } from '../types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SIZES = ['third', 'half', 'full']
const cacheKey = (page: string) => `jackal.layout.${page}`

const isPanelState = (x: unknown): x is PanelState =>
  !!x &&
  typeof x === 'object' &&
  typeof (x as PanelState).id === 'string' &&
  SIZES.includes((x as PanelState).size) &&
  typeof (x as PanelState).hidden === 'boolean'

// The last layout is also kept in this browser, so the page doesn't jump around while the saved one loads.
const readCache = (page: string): PanelState[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cacheKey(page)) ?? 'null')
    return Array.isArray(value) ? value.filter(isPanelState) : []
  } catch {
    return []
  }
}

const writeCache = (page: string, items: PanelState[]) => {
  try {
    if (items.length === 0) localStorage.removeItem(cacheKey(page))
    else localStorage.setItem(cacheKey(page), JSON.stringify(items))
  } catch {
    // Storage can be full or off. The saved copy on the server still works.
  }
}

/** The saved arrangement, then any panel that is new since it was saved (added at the end). */
export function mergeLayout(saved: PanelState[], defaults: PanelState[]): PanelState[] {
  const known = new Set(saved.map((s) => s.id))
  return [...saved, ...defaults.filter((d) => !known.has(d.id))]
}

const SAVE_DELAY_MS = 400

/**
 * A page's panel arrangement, saved to the account (so it follows the person to other browsers)
 * and shown straight away from this browser's copy.
 */
export function useBoardLayout(page: string, defaults: PanelState[]) {
  const [saved, setSaved] = useState<PanelState[]>(() => readCache(page))
  const [state, setState] = useState<SaveState>('idle')
  const changed = useRef(false) // once the person edits, a slow load must not overwrite it
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    layoutsApi
      .list()
      .then((all) => {
        if (cancelled || changed.current) return
        const items = all[page] ?? []
        setSaved(items)
        writeCache(page, items)
      })
      .catch(() => {
        // Offline or signed out: keep what this browser has.
      })
    return () => {
      cancelled = true
    }
  }, [page])

  // Leaving the page right after a change still saves it.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      pending.current?.()
    },
    [],
  )

  const persist = useCallback(
    (items: PanelState[] | null) => {
      clearTimeout(timer.current)
      setState('saving')
      const run = () => {
        pending.current = null
        const done = items ? layoutsApi.save(page, items) : layoutsApi.reset(page)
        done.then(
          () => setState('saved'),
          () => setState('error'),
        )
      }
      pending.current = run
      timer.current = setTimeout(run, SAVE_DELAY_MS)
    },
    [page],
  )

  const set = useCallback(
    (items: PanelState[]) => {
      changed.current = true
      setSaved(items)
      writeCache(page, items)
      persist(items)
    },
    [page, persist],
  )

  const reset = useCallback(() => {
    changed.current = true
    setSaved([])
    writeCache(page, [])
    persist(null)
  }, [page, persist])

  return { layout: mergeLayout(saved, defaults), set, reset, state }
}
