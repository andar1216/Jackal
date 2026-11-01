import { useCallback, useEffect, useRef, useState } from 'react'
import { CRUNCH_CHANGED, crunchApi } from '../../lib/api'
import type { CrunchData } from '../../types'

/** Crunch says check-ins take 24 to 48 hours to post, so refreshing more often than this gains nothing. */
const STALE_MS = 12 * 60 * 60 * 1000

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** Crunch data for the Fitness page: loads it, and refreshes it from Crunch when it is more than 12 hours old. */
export function useCrunch() {
  const [data, setData] = useState<CrunchData | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triedAuto = useRef(false)

  const load = useCallback(async () => {
    try {
      const d = await crunchApi.data()
      setData(d)
      return d
    } catch {
      return undefined // the panels just stay as they were
    }
  }, [])

  const sync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await crunchApi.sync()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSyncing(false)
      await load()
    }
  }, [load])

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      crunchApi.data().then(
        (d) => {
          if (!cancelled) setData(d)
          return d
        },
        () => undefined, // the panels just stay as they were
      )
    const onChange = () => void refresh()
    // Data sent from the Crunch tab arrives while this page is in the background, so look again on coming back.
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    window.addEventListener(CRUNCH_CHANGED, onChange)
    document.addEventListener('visibilitychange', onVisible)
    // Once per visit, bring stale data up to date without being asked (only possible with a saved login).
    void refresh().then((d) => {
      if (cancelled || !d?.connected || d.autoSync === false || triedAuto.current) return
      triedAuto.current = true
      const last = d.lastSyncedAt ? Date.parse(d.lastSyncedAt) : 0
      if (Date.now() - last > STALE_MS) void sync()
    })
    return () => {
      cancelled = true
      window.removeEventListener(CRUNCH_CHANGED, onChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync])

  return { data, syncing, error, sync }
}

export type Crunch = ReturnType<typeof useCrunch>
