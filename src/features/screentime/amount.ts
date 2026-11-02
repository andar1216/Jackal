import { useState } from 'react'

/** What a person picked: one of the listed choices (by its value), or "custom" with their own number. */
export type Amount = { choice: string; custom: number }
export type AmountOption = { value: string; label: string }

/** Valkyrie keeps 90 days of screen time, so a custom number of days can't go past that. */
export const MAX_DAYS = 90
/** The most items a custom list can show. */
export const MAX_ITEMS = 200

const storageKey = (key: string) => `valkyrie.screentime.${key}`

/** A choice that is remembered between visits, so each panel keeps how the person likes it. */
export function useAmount(key: string, initial: string, options: AmountOption[], custom: { start: number; max: number }) {
  const [amount, setAmount] = useState<Amount>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null')
      if (saved && typeof saved === 'object') {
        const { choice, custom: number } = saved as Partial<Amount>
        const known = typeof choice === 'string' && (choice === 'custom' || options.some((o) => o.value === choice))
        if (known && Number.isInteger(number) && number! >= 1 && number! <= custom.max) return { choice, custom: number! }
      }
    } catch {
      /* unreadable: start from the default */
    }
    return { choice: initial, custom: custom.start }
  })
  const update = (next: Amount) => {
    setAmount(next)
    localStorage.setItem(storageKey(key), JSON.stringify(next))
  }
  return [amount, update] as const
}

/** The number a choice means. "all" is every item, so it has no limit. */
export function amountOf(amount: Amount) {
  if (amount.choice === 'all') return Infinity
  return amount.choice === 'custom' ? amount.custom : Number(amount.choice)
}
