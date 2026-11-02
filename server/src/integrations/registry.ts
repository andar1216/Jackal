import { plaidGateway } from './plaidGateway.js'

export type Provider = {
  id: string
  name: string
  description: string
  category: 'calendar' | 'finance' | 'fitness' | 'screen-time'
  /** Whether the service offers an API for this, or we have to get at it another way (and it could break). */
  api: 'official' | 'unofficial'
  /** A page to open for services that are only linked to for now. */
  url?: string
  /** True once the connection flow and data sync for this provider are built. */
  implemented: boolean
  /** Optional extra check, such as API keys being present on the server. */
  isConfigured?: () => boolean
  /** Shown in the UI: what to expect or what's needed. */
  note?: string
}

/**
 * Every outside service Valkyrie should connect to (the project's Todo list).
 * We build them one at a time: finish one, flip `implemented` to true, then start the next.
 */
export const providers: Provider[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Show your Google Calendar events on the Calendar screen.',
    category: 'calendar',
    api: 'official',
    implemented: false,
    note: 'Official API. Needs a Google Cloud project with an OAuth client.',
  },
  {
    id: 'plaid',
    name: 'Plaid (bank accounts)',
    description: 'Import transactions from your personal and business accounts.',
    category: 'finance',
    api: 'official',
    implemented: true,
    isConfigured: () => plaidGateway().isConfigured(),
    note: 'Sign in to your bank through Plaid. Transfers between your own accounts are skipped.',
  },
  {
    id: 'myfitnesspal',
    name: 'MyFitnessPal',
    description: 'Pull calorie and meal tracking.',
    category: 'fitness',
    api: 'official',
    implemented: false,
    note: 'As far as we know, MyFitnessPal only gives its API to approved partners, so this may not be possible.',
  },
  {
    id: 'crunch',
    name: 'Crunch Fitness',
    description: 'Check-ins and weekly goal, class history and payment history from your Crunch membership.',
    category: 'fitness',
    api: 'unofficial',
    url: 'https://members.crunch.com/',
    implemented: true,
    note: 'Crunch has no public API. You sign in on members.crunch.com and a bookmark sends your data to Valkyrie (or let Valkyrie sign in for you, with your password stored encrypted). Either way it can break if Crunch changes their site.',
  },
  {
    id: 'samsung-screen-time',
    name: 'Samsung S23 screen time',
    description: 'Track phone screen time.',
    category: 'screen-time',
    api: 'unofficial',
    implemented: false,
    note: 'No public API. Would likely need a small companion app on the phone.',
  },
  {
    id: 'windows-screen-time',
    name: 'Windows screen time',
    description: 'Track time spent in apps on this PC.',
    category: 'screen-time',
    api: 'unofficial',
    implemented: true,
    note: 'Windows has no API for this. A small agent on the PC (agent/valkyrie-agent.mjs) reads which app is in front and sends the daily totals. Set it up on the Screen Time page.',
  },
]

export const findProvider = (id: string) => providers.find((p) => p.id === id)
