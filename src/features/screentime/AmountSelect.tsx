import { useState } from 'react'
import type { Amount, AmountOption } from './amount'

/** A drop-down of the usual choices, plus "Custom" which shows a box to type your own number. */
export default function AmountSelect({
  label,
  options,
  amount,
  onChange,
  unit,
  max,
}: {
  label: string
  options: AmountOption[]
  amount: Amount
  onChange: (next: Amount) => void
  /** What the custom number counts, shown after the box ("days", "apps"). */
  unit: string
  /** The biggest number the box accepts. */
  max: number
}) {
  // What is typed in the box, which can be empty or half-finished while typing. The real number only changes when it is valid.
  const [draft, setDraft] = useState(String(amount.custom))

  const type = (text: string) => {
    setDraft(text)
    const n = Number(text)
    if (text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max) onChange({ choice: 'custom', custom: n })
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <select aria-label={label} value={amount.choice} onChange={(e) => onChange({ ...amount, choice: e.target.value })}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {amount.choice === 'custom' && (
        <>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            aria-label={`${label}: how many ${unit} (1 to ${max})`}
            title={`1 to ${max}`}
            value={draft}
            onChange={(e) => type(e.target.value)}
            onBlur={() => setDraft(String(amount.custom))}
            style={{ width: 72 }}
          />
          <span className="stat-label">{unit}</span>
        </>
      )}
    </span>
  )
}
