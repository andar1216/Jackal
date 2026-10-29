import { plaidApi } from '../../lib/api'

/** Where Banks like Citi send the person back to after they approve access. Must match PLAID_REDIRECT_URI. */
export const PLAID_OAUTH_PATH = '/plaid-oauth'

// Plaid's OAuth banks leave our page and come back, so the link token has to survive the round trip.
const TOKEN_KEY = 'jackal.plaid.linkToken'
export const saveLinkToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const loadLinkToken = () => localStorage.getItem(TOKEN_KEY)
export const clearLinkToken = () => localStorage.removeItem(TOKEN_KEY)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Trades Plaid's one-time token for access and imports the history. A brand-new link often has
 * nothing ready for a few seconds, so it checks a few more times. Returns a message to show.
 */
export async function importNewBank(
  publicToken: string,
  institutionName: string | undefined,
  stillWanted: () => boolean = () => true,
): Promise<string> {
  const { institution, sync } = await plaidApi.exchange(publicToken, institutionName)
  if ('error' in sync) throw new Error(`${institution} is connected, but the import failed: ${sync.error}`)

  let added = sync.added
  for (let attempt = 0; attempt < 8 && added === 0 && stillWanted(); attempt++) {
    await wait(3000)
    added += (await plaidApi.sync()).added
  }
  return added > 0
    ? `Imported ${added} transactions from ${institution}. See them on the Finances screen.`
    : `${institution} is connected. Your bank hasn't sent any transactions yet, so try Sync now in a minute.`
}
