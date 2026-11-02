import { useCallback, useEffect, useState } from 'react'
import { SCREEN_TIME_CHANGED, screenTimeApi } from '../../lib/api'
import type { ScreenTimeData } from '../../types'

const REFRESH_MS = 60_000

/** What the devices have sent, kept fresh: the agents report about once a minute. */
export function useScreenTime() {
  const [data, setData] = useState<ScreenTimeData | null>(null)
  // When the data was fetched, so whether a computer is still reporting is judged by that and not by the page's own age.
  const [fetchedAt, setFetchedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      screenTimeApi.data().then(
        (d) => {
          if (cancelled) return
          setData(d)
          setFetchedAt(Date.now())
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
      setFetchedAt(Date.now())
      return d
    } catch {
      return undefined
    }
  }, [])

  return { data, fetchedAt, reload }
}

export type ScreenTime = ReturnType<typeof useScreenTime>
