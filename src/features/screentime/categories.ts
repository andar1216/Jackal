import type { AppCategoryEntry } from '../../types'

/** The categories offered in the drop-down. A person can also make their own. */
export const CATEGORIES = [
  'Social',
  'Video',
  'Music & audio',
  'Games',
  'Communication',
  'Browsers',
  'Productivity',
  'Development',
  'Shopping',
  'News',
  'Maps & travel',
  'Health & fitness',
  'Finance',
  'Food & drink',
  'Education',
  'Photos',
  'Utilities',
  'Other',
]
export const UNCATEGORIZED = 'Uncategorized'

// Guesses for common apps (by lower-case name) and websites (by domain), for what nobody has filed yet.
const APPS: Record<string, string> = {}
const SITES: Record<string, string> = {}
const add = (into: Record<string, string>, category: string, names: string[]) => names.forEach((n) => (into[n] = category))

add(APPS, 'Browsers', ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'safari', 'samsung internet', 'vivaldi'])
add(APPS, 'Development', ['code', 'cursor', 'visual studio code', 'windowsterminal', 'powershell', 'terminal', 'android studio', 'idea64', 'pycharm64', 'github desktop', 'gitkraken', 'devenv', 'termux'])
add(APPS, 'Communication', ['discord', 'slack', 'teams', 'microsoft teams', 'zoom', 'whatsapp', 'telegram', 'signal', 'messages', 'messenger', 'gmail', 'mail', 'outlook', 'phone', 'call', 'contacts', 'skype'])
add(APPS, 'Music & audio', ['spotify', 'youtube music', 'apple music', 'amazon music', 'podcasts', 'pocket casts', 'audible', 'shazam'])
add(APPS, 'Video', ['youtube', 'netflix', 'disney+', 'hulu', 'prime video', 'twitch', 'vlc', 'plex', 'max', 'tubi'])
add(APPS, 'Social', ['instagram', 'facebook', 'twitter', 'x', 'reddit', 'tiktok', 'snapchat', 'linkedin', 'pinterest', 'threads', 'bereal', 'tumblr'])
add(APPS, 'Games', ['steam', 'epic games launcher', 'battle.net', 'minecraft', 'roblox', 'league of legends', 'valorant'])
add(APPS, 'Maps & travel', ['maps', 'google maps', 'waze', 'uber', 'lyft', 'google earth'])
add(APPS, 'Productivity', ['winword', 'word', 'excel', 'powerpnt', 'powerpoint', 'onenote', 'notion', 'obsidian', 'docs', 'sheets', 'slides', 'calendar', 'notes', 'drive', 'google drive', 'keep', 'todoist', 'trello', 'canva'])
add(APPS, 'Shopping', ['amazon', 'amazon shopping', 'ebay', 'etsy', 'walmart', 'target', 'temu', 'shein', 'aliexpress'])
add(APPS, 'Health & fitness', ['strong', 'samsung health', 'fitbit', 'myfitnesspal', 'strava', 'google fit', 'peloton'])
add(APPS, 'Finance', ['chase', 'bank of america', 'venmo', 'cash app', 'paypal', 'robinhood', 'coinbase', 'wells fargo'])
add(APPS, 'Education', ['duolingo', 'khan academy', 'coursera', 'quizlet', 'anki'])
add(APPS, 'Photos', ['camera', 'gallery', 'photos', 'google photos', 'lightroom'])
add(APPS, 'Utilities', ['digital wellbeing', 'settings', 'file explorer', 'explorer', 'calculator', 'clock', 'gboard', 'files', 'my files', 'taskmgr', 'lockapp', 'searchhost', 'applicationframehost'])

add(APPS, 'Food & drink', ['chipotle', 'texas roadhouse', 'doordash', 'uber eats', 'starbucks', "mcdonald's", 'grubhub', "domino's", 'dunkin'])
add(APPS, 'Productivity', ['samsung notes', 'claude', 'chatgpt', 'valkyrie'])
add(APPS, 'Finance', ['samsung wallet'])
add(APPS, 'Health & fitness', ['crunch'])
add(APPS, 'Utilities', ['google', 'weather', 'samsung account', 'samsung pass', 'autofill with samsung pass', 'permission controller', 'package installer', 'settings suggestions', 'samsung capture', 'google play services', 'google play store', 'snippingtool', 'openwith', 'shellexperiencehost'])

add(SITES, 'Video', ['youtube.com', 'netflix.com', 'twitch.tv', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'max.com'])
add(SITES, 'Music & audio', ['spotify.com', 'soundcloud.com', 'music.youtube.com'])
add(SITES, 'Social', ['instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'reddit.com', 'tiktok.com', 'linkedin.com', 'snapchat.com', 'pinterest.com', 'threads.net'])
add(SITES, 'Development', ['github.com', 'stackoverflow.com', 'gitlab.com', 'npmjs.com', 'developer.mozilla.org', 'localhost', 'vercel.com', 'ngrok.com', 'cursor.com'])
add(SITES, 'Communication', ['mail.google.com', 'gmail.com', 'outlook.com', 'outlook.live.com', 'discord.com', 'slack.com', 'zoom.us', 'teams.microsoft.com', 'web.whatsapp.com', 'messenger.com'])
add(SITES, 'Productivity', ['docs.google.com', 'drive.google.com', 'notion.so', 'office.com', 'sheets.google.com', 'calendar.google.com', 'trello.com', 'figma.com', 'canva.com'])
add(SITES, 'Shopping', ['amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'temu.com'])
add(SITES, 'News', ['nytimes.com', 'cnn.com', 'bbc.com', 'foxnews.com', 'news.google.com', 'apnews.com', 'washingtonpost.com', 'theguardian.com'])
add(SITES, 'Maps & travel', ['maps.google.com', 'tripadvisor.com', 'booking.com', 'airbnb.com'])
add(SITES, 'Education', ['wikipedia.org', 'khanacademy.org', 'coursera.org', 'duolingo.com', 'quizlet.com'])
add(SITES, 'Finance', ['chase.com', 'paypal.com', 'venmo.com', 'bankofamerica.com', 'robinhood.com', 'coinbase.com'])
add(SITES, 'Games', ['steampowered.com', 'store.steampowered.com', 'epicgames.com', 'ubisoft.com'])
add(SITES, 'Health & fitness', ['crunch.com'])
add(SITES, 'Utilities', ['google.com', 'chromewebstore.google.com'])
add(SITES, 'Development', ['ngrok.dev'])

/** What a name looks like it is, or null when there is no good guess. */
export function guessCategory(kind: 'app' | 'site', name: string): string | null {
  const lower = name.trim().toLowerCase()
  if (kind === 'app') return APPS[lower.replace(/\.exe$/, '')] ?? null
  const host = lower.replace(/^www\./, '')
  if (SITES[host]) return SITES[host]
  // "m.youtube.com" is youtube.com: try the shorter forms of the name.
  const parts = host.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.')
    if (SITES[parent]) return SITES[parent]
  }
  return null
}

/** Where a category came from: the person's own choice, a guess from the name, what Android says, or nowhere. */
export type CategorySource = 'mine' | 'guess' | 'phone' | 'none'

/**
 * Works out the category of an app or website: the person's choice first, then a guess from the name for the ones
 * Valkyrie knows, then what Android says (apps often declare something odd, like Clock as "Productivity").
 */
export function makeCategorizer(entries: AppCategoryEntry[]) {
  const byKey = new Map(entries.map((e) => [`${e.kind}:${e.name}`, e]))
  return (kind: 'app' | 'site', name: string): { category: string; source: CategorySource } => {
    const entry = byKey.get(`${kind}:${name}`)
    if (entry?.mine) return { category: entry.mine, source: 'mine' }
    const guess = guessCategory(kind, name)
    if (guess) return { category: guess, source: 'guess' }
    if (entry?.phone) return { category: entry.phone, source: 'phone' }
    return { category: UNCATEGORIZED, source: 'none' }
  }
}
