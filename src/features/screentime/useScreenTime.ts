import { useCallback, useEffect, useState } from 'react'
import { SCREEN_TIME_CHANGED, screenTimeApi } from '../../lib/api'
import type { ScreenTimeData } from '../../types'

const REFRESH_MS = 60_000

/** What ActivityWatch has recorded, kept fresh: Valkyrie reads it every few minutes. */
export function useScreenTime() {
  const [data, setData] = useState<ScreenTimeData | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      screenTimeApi.data().then(
        (d) => {
          if (cancelled) return
          setData(d)
        },
        () => undefined, // the panels just stay as they were
      )
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    window.addEventListener(SCREEN_TIME_CHANGED, onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(SCREEN_TIME_CHANGED, onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  /** Look again right now (for example while waiting for a new agent to report). */
  const reload = useCallback(async () => {
    try {
      const d = await screenTimeApi.data()
      setData(d)
      return d
    } catch {
      return undefined
    }
  }, [])

  return { data, reload }
}

export type ScreenTime = ReturnType<typeof useScreenTime>
