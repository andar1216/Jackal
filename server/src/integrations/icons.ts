import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Small pictures for the Screen Time lists: a website's own favicon, and an app's own icon.
 * Both are fetched on this computer (not through a third-party icon service), so the list of sites you visit is never
 * handed to anyone but the sites themselves. They are remembered, so each is looked up once.
 */
export type Icon = { type: string; data: Buffer }

export type IconSources = {
  site(domain: string): Promise<Icon | null>
  app(name: string): Promise<Icon | null>
}

const MAX_BYTES = 200_000
const IMAGE_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/gif', 'image/jpeg', 'image/webp', 'image/svg+xml']
const UA = 'Valkyrie/1.0 (personal tracker; fetching a site icon for your own screen time list)'

/** A real website name. Not an address, a port, a path, "localhost", or anything on a private network. */
export function isPublicDomain(domain: string) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain) || domain.length > 120) return false
  if (/^\d+(\.\d+)*$/.test(domain)) return false // a bare IP address
  return !/\.(local|localhost|internal|lan|home|corp|test)$/i.test(domain)
}

/** Reads a response body, giving up past `limit` bytes. */
async function readLimited(res: Response, limit: number): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function get(url: string) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(4000) })
    return res.ok ? res : null
  } catch {
    return null
  }
}

async function imageAt(url: string): Promise<Icon | null> {
  const res = await get(url)
  if (!res) return null
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!IMAGE_TYPES.includes(type)) return null
  const data = await readLimited(res, MAX_BYTES)
  return data && data.length > 0 ? { type, data } : null
}

/** The address of the icon a page names in its own head, if it names one. */
export function iconLink(html: string, base: string) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(tag)) continue
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    try {
      const url = new URL(href, base)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString()
    } catch {
      /* not a usable address: try the next one */
    }
  }
  return undefined
}

async function fetchSiteIcon(domain: string): Promise<Icon | null> {
  if (!isPublicDomain(domain)) return null
  const base = `https://${domain}/`
  const direct = await imageAt(`${base}favicon.ico`)
  if (direct) return direct
  const page = await get(base)
  const html = page ? await readLimited(page, 300_000) : null
  const link = html ? iconLink(html.toString('utf8'), page?.url || base) : undefined
  return link ? imageAt(link) : null
}

/* ---------- App icons (Windows) ---------- */

const dir = join(process.env.APPDATA ?? tmpdir(), 'Valkyrie', 'icons')

// Finds the program (running now, or registered by its installer), then asks Windows for its icon as a PNG.
// The app's name arrives in an environment variable, never inside the script text.
const EXTRACT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$name = $env:VALKYRIE_APP
$path = $null
$p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
if ($p) { $path = $p.Path }
if (-not $path) {
  foreach ($root in 'HKLM:', 'HKCU:') {
    $key = "$root\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$name.exe"
    if (Test-Path -LiteralPath $key) {
      $v = (Get-ItemProperty -LiteralPath $key).'(default)'
      if ($v) { $path = $v.Trim('"'); break }
    }
  }
}
if (-not $path -or -not (Test-Path -LiteralPath $path)) { exit 3 }
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
$ms = New-Object System.IO.MemoryStream
$icon.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`

/** An app name Windows could know a program by. No wildcards, paths or quotes. */
export const isAppName = (name: string) => /^[\w .()+-]{1,80}$/.test(name) && !/^\.+$/.test(name)

// One PowerShell at a time, so a page of icons does not start a dozen of them.
let queue: Promise<unknown> = Promise.resolve()

function extractAppIcon(name: string): Promise<Buffer | null> {
  const job = () =>
    new Promise<Buffer | null>((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(EXTRACT, 'utf16le').toString('base64')],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, VALKYRIE_APP: name } },
      )
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      const timer = setTimeout(() => child.kill(), 15_000)
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        clearTimeout(timer)
        const data = code === 0 && out ? Buffer.from(out.trim(), 'base64') : null
        resolve(data && data.length > 0 ? data : null)
      })
    })
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

async function fetchAppIcon(name: string): Promise<Icon | null> {
  if (process.platform !== 'win32' || !isAppName(name)) return null
  const file = join(dir, `${name.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}.png`)
  try {
    return { type: 'image/png', data: readFileSync(file) } // found before, and kept for when the program is not running
  } catch {
    /* not saved yet */
  }
  const data = await extractAppIcon(name)
  if (!data) return null
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, data)
  } catch {
    /* the picture is still used this time */
  }
  return { type: 'image/png', data }
}

/* ---------- Remembering ---------- */

const REMEMBER_MS = 7 * 24 * 3600 * 1000
const RETRY_MS = 30 * 60 * 1000
const remembered = new Map<string, { icon: Icon | null; at: number }>()

async function remember(key: string, find: () => Promise<Icon | null>) {
  const hit = remembered.get(key)
  if (hit && Date.now() - hit.at < (hit.icon ? REMEMBER_MS : RETRY_MS)) return hit.icon
  const icon = await find().catch(() => null)
  remembered.set(key, { icon, at: Date.now() })
  return icon
}

const realSources: IconSources = {
  site: (domain) => remember(`site:${domain}`, () => fetchSiteIcon(domain)),
  app: (name) => remember(`app:${name.toLowerCase()}`, () => fetchAppIcon(name)),
}

export let iconSources: IconSources = realSources
/** Tests swap this so nothing goes out to the internet or starts a program. */
export const setIconSources = (s: IconSources) => {
  iconSources = s
}
