import { useCallback, useEffect, useState } from 'react'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export type DayEntries<T, New> = {
  items: T[]
  /** False until the first load finishes, so a page can tell "empty" from "not here yet". */
  loaded: boolean
  error: string | null
  add: (entry: New) => Promise<boolean>
  remove: (id: string) => Promise<void>
  /** Loads the list again, for entries that arrived another way (an import). */
  reload: () => Promise<void>
}

/** A list of entries that each belong to a day (meals, workouts), kept on the server. */
export function useDayEntries<T extends { id: string }, New>(api: {
  list: () => Promise<T[]>
  create: (entry: New) => Promise<T>
  remove: (id: string) => Promise<void>
}): DayEntries<T, New> {
  const [items, setItems] = useState<T[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setLoaded(true)
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [api])

  const add = useCallback(
    async (entry: New) => {
      try {
        const created = await api.create(entry)
        setItems((p) => [...p, created])
        setError(null)
        return true
      } catch (err) {
        setError(errorText(err))
        return false
      }
    },
    [api],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.remove(id)
        setItems((p) => p.filter((x) => x.id !== id))
        setError(null)
      } catch (err) {
        setError(errorText(err))
      }
    },
    [api],
  )

  const reload = useCallback(async () => {
    try {
      setItems(await api.list())
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [api])

  return { items, loaded, error, add, remove, reload }
}
