import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Router } from 'express'
import { currentUserId } from '../auth/middleware.js'
import { config } from '../config.js'
import { HttpError } from '../lib/errors.js'
import { Connection, ScreenTimeSite, ScreenTimeUsage } from '../models.js'

/**
 * Reads screen time from ActivityWatch (https://activitywatch.net), a free program that runs on this computer, counts
 * time in each app and, with its Chrome extension, on each website. Valkyrie asks it for daily totals through its local
 * API and keeps only app names, website names and seconds. Window titles and page addresses are never stored here.
 */
export const ACTIVITYWATCH_PROVIDER = 'activitywatch'
const SOURCE = 'activitywatch'

export type AwBucket = { id: string; type: string; client: string; hostname: string }

export type AwGateway = {
  /** Null when ActivityWatch is not running (or not reachable). */
  info(): Promise<{ hostname: string; version: string } | null>
  buckets(): Promise<AwBucket[]>
  /** One result per time period. */
  query(timeperiods: string[], query: string[]): Promise<unknown[]>
}

const realGateway: AwGateway = {
  async info() {
    try {
      const res = await fetch(`${config.activityWatchUrl}/api/0/info`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return null
      const j = (await res.json()) as { hostname?: string; version?: string }
      return { hostname: String(j.hostname ?? ''), version: String(j.version ?? '') }
    } catch {
      return null
    }
  },
  async buckets() {
    const res = await fetch(`${config.activityWatchUrl}/api/0/buckets/`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new HttpError(502, `ActivityWatch answered ${res.status}.`)
    const j = (await res.json()) as Record<string, { id?: string; type?: string; client?: string; hostname?: string }>
    return Object.entries(j).map(([id, b]) => ({ id: b.id ?? id, type: String(b.type ?? ''), client: String(b.client ?? ''), hostname: String(b.hostname ?? '') }))
  },
  async query(timeperiods, query) {
    const res = await fetch(`${config.activityWatchUrl}/api/0/query/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeperiods, query }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new HttpError(502, `ActivityWatch could not answer the query (${res.status}). ${detail.slice(0, 200)}`.trim())
    }
    return (await res.json()) as unknown[]
  },
}

let gateway: AwGateway = realGateway
/** Tests swap this for a pretend ActivityWatch. */
export const setActivityWatchGateway = (g: AwGateway) => {
  gateway = g
}

/** Where its installer puts the tray program, if it is installed. */
function installedProgram() {
  const roots = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles].filter(Boolean) as string[]
  return roots.map((r) => join(r, 'ActivityWatch', 'aw-qt.exe')).find((p) => existsSync(p))
}
export let findProgram = installedProgram
export const setProgramFinder = (f: () => string | undefined) => {
  findProgram = f
}

/* ---------- Reading ---------- */

const BROWSERS = [
  'Google-chrome', 'chrome.exe', 'Chromium', 'Google Chrome', 'Chromium-browser', 'Chromium-browser-chromium',
  'Google-chrome-beta', 'Google-chrome-unstable', 'msedge.exe', 'Microsoft-edge', 'brave.exe', 'Brave-browser',
  'firefox.exe', 'Firefox', 'firefox', 'opera.exe', 'vivaldi.exe',
]

const pad = (n: number) => String(n).padStart(2, '0')
/** RFC 3339 in the server's own time zone, which is what ActivityWatch needs to cut days where yours end. */
function localIso(d: Date) {
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** The last `count` days as { key: 'YYYY-MM-DD', period: 'start/end' }, oldest first. */
function dayPeriods(count: number, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i))
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    return { key: start.toLocaleDateString('en-CA'), period: `${localIso(start)}/${localIso(end)}` }
  })
}

const safeId = (id: string) => !/["'\\]/.test(id)

type Picked = { window?: string; afk?: string; web: string[] }

/** Which of ActivityWatch's buckets to read: the ones from this computer. */
export function pickBuckets(all: AwBucket[], hostname: string): Picked {
  const mine = all.filter((b) => (b.hostname === hostname || !hostname) && safeId(b.id))
  const first = (prefix: string) => mine.find((b) => b.id.startsWith(prefix))?.id
  return {
    window: first('aw-watcher-window'),
    afk: first('aw-watcher-afk'),
    web: mine.filter((b) => b.id.startsWith('aw-watcher-web')).map((b) => b.id),
  }
}

function activeWindowLines(b: Picked) {
  const lines = [`window = flood(query_bucket("${b.window}"));`]
  if (b.afk) {
    lines.push(`afk = flood(query_bucket("${b.afk}"));`, 'not_afk = filter_keyvals(afk, "status", ["not-afk"]);', 'active = filter_period_intersect(window, not_afk);')
  } else {
    lines.push('active = window;')
  }
  return lines
}

export const appQuery = (b: Picked) => [...activeWindowLines(b), 'RETURN = merge_events_by_keys(active, ["app"]);']

export const webQuery = (b: Picked) => [
  ...activeWindowLines(b),
  `browser = filter_keyvals(active, "app", ${JSON.stringify(BROWSERS)});`,
  `web = flood(query_bucket("${b.web[0]}"));`,
  ...b.web.slice(1).map((id) => `web = concat(web, flood(query_bucket("${id}")));`),
  'web = filter_period_intersect(web, browser);',
  'RETURN = merge_events_by_keys(web, ["url"]);',
]

type AwEvent = { duration?: number; data?: Record<string, unknown> }
const events = (v: unknown): AwEvent[] => (Array.isArray(v) ? (v as AwEvent[]) : [])

/** "chrome.exe" becomes "chrome", the way Valkyrie's own agent names programs. */
export const appName = (raw: unknown) => String(raw ?? '').trim().replace(/\.exe$/i, '')

/** "https://www.YouTube.com/watch?v=1" becomes "youtube.com". Anything that is not a web page gives undefined. */
export function siteName(url: unknown) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.hostname.toLowerCase().replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

function addUp(list: AwEvent[], key: (e: AwEvent) => string | undefined) {
  const totals = new Map<string, number>()
  for (const e of list) {
    const name = key(e)
    const seconds = Number(e.duration)
    if (!name || !Number.isFinite(seconds)) continue
    totals.set(name.slice(0, 120), (totals.get(name.slice(0, 120)) ?? 0) + seconds)
  }
  return [...totals.entries()]
    .map(([name, seconds]) => ({ name, seconds: Math.min(86_400, Math.round(seconds)) }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 500)
}

export type SyncResult = { days: number; apps: number; sites: number }

/** Reads the last `days` days from ActivityWatch and replaces Valkyrie's copy of them. */
export async function syncActivityWatch(userId: unknown, days: number): Promise<SyncResult> {
  const info = await gateway.info()
  if (!info) throw new HttpError(409, "ActivityWatch isn't running. Start it (it lives in the system tray) and try again.")
  const device = info.hostname || 'This computer'
  const picked = pickBuckets(await gateway.buckets(), info.hostname)
  if (!picked.window) throw new HttpError(409, 'ActivityWatch has no window data yet. Let it run for a minute and try again.')

  const periods = dayPeriods(days)
  const timeperiods = periods.map((p) => p.period)
  const appResults = await gateway.query(timeperiods, appQuery(picked))
  const webResults = picked.web.length ? await gateway.query(timeperiods, webQuery(picked)) : []

  const apps = periods.flatMap((p, i) =>
    addUp(events(appResults[i]), (e) => appName(e.data?.app) || undefined).map((r) => ({ userId, device, source: SOURCE, day: p.key, app: r.name, seconds: r.seconds })),
  )
  const sites = periods.flatMap((p, i) => {
    const bySite = addUp(events(webResults[i]), (e) => siteName(e.data?.url))
    return bySite.map((r) => ({ userId, device, source: SOURCE, day: p.key, site: r.name, seconds: r.seconds }))
  })

  // ActivityWatch is the source of truth for these days, so what was here is replaced, not added to.
  const keys = periods.map((p) => p.key)
  await Promise.all([
    ScreenTimeUsage.deleteMany({ userId, source: SOURCE, day: { $in: keys } }),
    ScreenTimeSite.deleteMany({ userId, source: SOURCE, day: { $in: keys } }),
  ])
  if (apps.length) await ScreenTimeUsage.insertMany(apps)
  if (sites.length) await ScreenTimeSite.insertMany(sites)

  const now = new Date()
  await Connection.findOneAndUpdate({ userId, provider: ACTIVITYWATCH_PROVIDER }, { lastSyncedAt: now }, { upsert: false })
  return { days, apps: apps.length, sites: sites.length }
}

/* ---------- What the Screen Time page uses ---------- */

export const activityWatchRouter = Router()

const FIRST_DAYS = 30
const REFRESH_DAYS = 3

async function status(userId: unknown) {
  const [info, connection] = await Promise.all([gateway.info(), Connection.findOne({ userId, provider: ACTIVITYWATCH_PROVIDER })])
  let found: { window: boolean; afk: boolean; web: number } | null = null
  if (info) {
    try {
      const picked = pickBuckets(await gateway.buckets(), info.hostname)
      found = { window: !!picked.window, afk: !!picked.afk, web: picked.web.length }
    } catch {
      found = null
    }
  }
  return {
    running: !!info,
    version: info?.version ?? null,
    hostname: info?.hostname ?? null,
    watchers: found,
    installed: !!findProgram(),
    connected: !!connection,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
  }
}

activityWatchRouter.get('/', async (req, res) => {
  res.json(await status(currentUserId(req)))
})

// Start the tray program if it is installed but not running.
activityWatchRouter.post('/start', async (req, res) => {
  const userId = currentUserId(req)
  if (!(await gateway.info())) {
    const program = findProgram()
    if (!program) throw new HttpError(404, 'ActivityWatch is not installed. Download it first.')
    spawn(program, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    for (let i = 0; i < 24 && !(await gateway.info()); i++) await new Promise((r) => setTimeout(r, 500))
  }
  res.json(await status(userId))
})

// Connect: check it is there, remember that, and read the last month.
activityWatchRouter.post('/connect', async (req, res) => {
  const userId = currentUserId(req)
  const info = await gateway.info()
  if (!info) throw new HttpError(409, "ActivityWatch isn't running. Start it (it lives in the system tray) and try again.")
  await Connection.findOneAndUpdate(
    { userId, provider: ACTIVITYWATCH_PROVIDER },
    { $setOnInsert: { connectedAt: new Date() }, accountLabel: `ActivityWatch ${info.version}`.trim() },
    { upsert: true },
  )
  const result = await syncActivityWatch(userId, FIRST_DAYS)
  res.json({ ...result, status: await status(userId) })
})

activityWatchRouter.post('/sync', async (req, res) => {
  const userId = currentUserId(req)
  if (!(await Connection.exists({ userId, provider: ACTIVITYWATCH_PROVIDER }))) throw new HttpError(409, 'Connect ActivityWatch first.')
  const result = await syncActivityWatch(userId, REFRESH_DAYS)
  res.json({ ...result, status: await status(userId) })
})

/** Forget the connection and what was read from ActivityWatch. (ActivityWatch's own data is not touched.) */
export async function disconnectActivityWatch(userId: unknown) {
  await Promise.all([
    ScreenTimeUsage.deleteMany({ userId, source: SOURCE }),
    ScreenTimeSite.deleteMany({ userId, source: SOURCE }),
    Connection.deleteOne({ userId, provider: ACTIVITYWATCH_PROVIDER }),
  ])
}

/* ---------- Keeping up to date ---------- */

const REFRESH_EVERY_MS = 5 * 60 * 1000

/** While the server runs, bring every connected person's last few days up to date every few minutes. */
export function startActivityWatchTimer() {
  const timer = setInterval(async () => {
    try {
      if (!(await gateway.info())) return
      for (const c of await Connection.find({ provider: ACTIVITYWATCH_PROVIDER })) {
        await syncActivityWatch(c.userId, REFRESH_DAYS).catch((err) => console.warn('ActivityWatch refresh failed:', err instanceof Error ? err.message : err))
      }
    } catch (err) {
      console.warn('ActivityWatch refresh failed:', err instanceof Error ? err.message : err)
    }
  }, REFRESH_EVERY_MS)
  timer.unref()
}
