import { useCallback, useEffect, useState } from 'react'
import { activityWatchApi, integrationsApi } from '../../lib/api'
import type { ActivityWatchStatus } from '../../types'
import type { ScreenTime } from './useScreenTime'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

type Job = () => Promise<{ status: ActivityWatchStatus; apps: number; sites: number } | ActivityWatchStatus>

/** ActivityWatch on this computer: whether it is running and connected (checked every few seconds), and what can be done about it. */
export function useActivityWatch(screenTime: ScreenTime) {
  const [status, setStatus] = useState<ActivityWatchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { reload } = screenTime

  useEffect(() => {
    let cancelled = false
    const look = () =>
      activityWatchApi.status().then(
        (s) => !cancelled && setStatus(s),
        () => undefined,
      )
    void look()
    const timer = setInterval(() => void look(), 10_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const act = useCallback(
    async (job: Job, done?: (apps: number, sites: number) => string) => {
      setBusy(true)
      setError(null)
      setNote(null)
      try {
        const r = await job()
        if ('status' in r) {
          setStatus(r.status)
          if (done) setNote(done(r.apps, r.sites))
        } else {
          setStatus(r)
        }
        await reload()
      } catch (err) {
        setError(errorText(err))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  const read = (apps: number, sites: number) => `Read ${apps} app totals and ${sites} website totals.`

  const disconnect = async () => {
    if (!window.confirm('Disconnect ActivityWatch? The numbers Valkyrie read from it are removed here (ActivityWatch keeps its own).')) return
    setBusy(true)
    setError(null)
    try {
      await integrationsApi.disconnect('activitywatch')
      setStatus(await activityWatchApi.status())
      await reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return {
    status,
    busy,
    error,
    note,
    connect: () => act(activityWatchApi.connect, read),
    sync: () => act(activityWatchApi.sync, read),
    start: () => act(activityWatchApi.start),
    disconnect,
  }
}

export type ActivityWatchState = ReturnType<typeof useActivityWatch>
