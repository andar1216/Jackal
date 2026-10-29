/** What Plaid reports for an account's balance, in dollars. */
export type PlaidBalances = { type?: string | null; current?: number | null; available?: number | null; limit?: number | null }

/**
 * The balance to store, in cents. For a credit card this is what is owed.
 *
 * Some banks (U.S. Bank, for one) report a current balance of 0 on a card that is clearly in use,
 * while the available credit is right. When a card says 0 owed but has less available credit than
 * its limit, use limit minus available instead.
 */
export function balanceCents({ type, current, available, limit }: PlaidBalances): number | undefined {
  const reported = typeof current === 'number' ? current : undefined
  if (type === 'credit' && (reported ?? 0) <= 0 && typeof limit === 'number' && limit > 0 && typeof available === 'number') {
    const used = limit - available
    if (used > 0) return Math.round(used * 100)
  }
  return reported === undefined ? undefined : Math.round(reported * 100)
}
