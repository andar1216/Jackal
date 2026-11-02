import { format, parseISO, subDays } from 'date-fns'
import type { ScreenTimeSite, ScreenTimeUsage } from '../../types'

/** "2h 5m", "45m", or "<1m" for a little. */
export function formatSeconds(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (seconds > 0 && minutes < 1) return '<1m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Seconds on each day, summed over every app (and every device in the list). */
export function totalsByDay(usage: ScreenTimeUsage[]) {
  const byDay: Record<string, number> = {}
  for (const u of usage) byDay[u.day] = (byDay[u.day] ?? 0) + u.seconds
  return byDay
}

/** Only the rows from one kind of device. */
export const ofKind = (usage: ScreenTimeUsage[], kind: ScreenTimeUsage['kind']) => usage.filter((u) => u.kind === kind)

/** The apps used most in the last `days` days (1 means today only), biggest first. The same name on computer and phone stays two lines. */
export function topApps(usage: ScreenTimeUsage[], days: number, today: Date = new Date()) {
  const since = format(subDays(today, days - 1), 'yyyy-MM-dd')
  const byApp = new Map<string, { app: string; kind: ScreenTimeUsage['kind']; seconds: number }>()
  for (const u of usage) {
    if (u.day < since) continue
    const key = `${u.kind}:${u.app}`
    const line = byApp.get(key) ?? { app: u.app, kind: u.kind, seconds: 0 }
    line.seconds += u.seconds
    byApp.set(key, line)
  }
  return [...byApp.values()].sort((a, b) => b.seconds - a.seconds)
}

/** The websites used most in the last days days (1 means today only), biggest first. */
export function topSites(sites: ScreenTimeSite[], days: number, today: Date = new Date()) {
  const since = format(subDays(today, days - 1), 'yyyy-MM-dd')
  const bySite = new Map<string, number>()
  for (const s of sites) {
    if (s.day < since) continue
    bySite.set(s.site, (bySite.get(s.site) ?? 0) + s.seconds)
  }
  return [...bySite.entries()].map(([site, seconds]) => ({ site, seconds })).sort((a, b) => b.seconds - a.seconds)
}

// The program's own name, tidied up for reading.
const NAMES: Record<string, string> = {
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  code: 'VS Code',
  cursor: 'Cursor',
  explorer: 'File Explorer',
  windowsterminal: 'Terminal',
  powershell: 'PowerShell',
  applicationframehost: 'Windows apps',
  searchhost: 'Search',
  lockapp: 'Lock screen',
  discord: 'Discord',
  spotify: 'Spotify',
  slack: 'Slack',
  teams: 'Teams',
  outlook: 'Outlook',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  steam: 'Steam',
}

export function appName(raw: string) {
  const known = NAMES[raw.toLowerCase()]
  if (known) return known
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/** The last `count` days ending today, newest first, with a total for each (zero when nothing was counted). */
export function recentDays(byDay: Record<string, number>, count: number, today: Date = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const date = subDays(today, i)
    const key = format(date, 'yyyy-MM-dd')
    return { key, date: parseISO(key), seconds: byDay[key] ?? 0 }
  })
}
