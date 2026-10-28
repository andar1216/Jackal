import { plaidGateway } from './plaidGateway.js'

export type Provider = {
  id: string
  name: string
  description: string
  category: 'calendar' | 'finance' | 'fitness' | 'screen-time'
  /** True once the connection flow and data sync for this provider are built. */
  implemented: boolean
  /** Optional extra check, such as API keys being present on the server. */
  isConfigured?: () => boolean
  /** Shown in the UI: what to expect or what's needed. */
  note?: string
}

/**
 * Every outside service Jackal should connect to (the project's Todo list).
 * We build them one at a time: finish one, flip `implemented` to true, then start the next.
 */
export const providers: Provider[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Show your Google Calendar events on the Calendar screen.',
    category: 'calendar',
    implemented: false,
    note: 'Official API. Needs a Google Cloud project with an OAuth client.',
  },
  {
    id: 'plaid',
    name: 'Plaid (bank accounts)',
    description: 'Import transactions from your personal and business accounts.',
    category: 'finance',
    implemented: true,
    isConfigured: () => plaidGateway().isConfigured(),
    note: 'Sign in to your bank through Plaid. Transfers between your own accounts are skipped.',
  },
  {
    id: 'myfitnesspal',
    name: 'MyFitnessPal',
    description: 'Pull calorie and meal tracking.',
    category: 'fitness',
    implemented: false,
    note: 'As far as we know, MyFitnessPal only gives its API to approved partners, so this may not be possible.',
  },
  {
    id: 'crunch',
    name: 'Crunch Fitness',
    description: 'Log gym sessions.',
    category: 'fitness',
    implemented: false,
    note: 'Unofficial API. It can break without warning and may go against their terms.',
  },
  {
    id: 'samsung-screen-time',
    name: 'Samsung S23 screen time',
    description: 'Track phone screen time.',
    category: 'screen-time',
    implemented: false,
    note: 'No public API. Would likely need a small companion app on the phone.',
  },
  {
    id: 'windows-screen-time',
    name: 'Windows screen time',
    description: 'Track time spent in apps on this PC.',
    category: 'screen-time',
    implemented: false,
    note: 'Needs a small background agent running on the PC.',
  },
]

export const findProvider = (id: string) => providers.find((p) => p.id === id)
