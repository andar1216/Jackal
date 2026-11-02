import { useEffect, useRef, useState } from 'react'
import { phoneApi } from '../../lib/api'
import type { PhonePairCode, PhoneStatus } from '../../types'
import type { ScreenTime } from './useScreenTime'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export type Pairing = PhonePairCode & { baseline: number }

/** The phones paired with Valkyrie, kept fresh, and the steps for pairing another. */
export function usePhones(screenTime: ScreenTime) {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seen = useRef<string | null>(null)
  const { reload } = screenTime
  const waiting = pairing !== null

  // Which phones are paired and when each last sent numbers: often while a code is showing, now and then otherwise.
  useEffect(() => {
    let cancelled = false
    const look = () =>
      phoneApi.status().then(
        (s) => {
          if (cancelled) return
          setStatus(s)
          const signature = s.devices.map((d) => `${d.id}:${d.lastSyncedAt}`).join('|')
          if (seen.current !== null && seen.current !== signature) void reload() // new numbers arrived
          seen.current = signature
        },
        () => undefined,
      )
    void look()
    const timer = setInterval(() => void look(), waiting ? 3_000 : 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [waiting, reload])

  const devices = status?.devices ?? []
  const justPaired = pairing !== null && devices.length > pairing.baseline

  const makeCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const code = await phoneApi.pairCode()
      setPairing({ ...code, baseline: devices.length })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await phoneApi.remove(id)
      setStatus(await phoneApi.status())
      await reload()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  return { devices, pairing, justPaired, busy, error, makeCode, closePairing: () => setPairing(null), clearError: () => setError(null), remove }
}

export type PhonesState = ReturnType<typeof usePhones>
