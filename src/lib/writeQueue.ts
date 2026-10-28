/**
 * Runs async tasks one at a time, in the order they were added, so quick successive
 * writes (like clicking several days) can't reach the server out of order.
 * A failed task calls `onError` and the queue keeps going.
 */
export function createWriteQueue(onError: (err: unknown) => void | Promise<void>) {
  let chain: Promise<unknown> = Promise.resolve()
  let pending = 0

  return {
    enqueue(task: () => Promise<void>) {
      pending++
      chain = chain
        .then(task)
        .catch(onError)
        .finally(() => {
          pending--
        })
    },
    /** Tasks queued or running, including the current one. */
    get pending() {
      return pending
    },
  }
}
