#!/usr/bin/env node
// Valkyrie computer agent (Windows). Counts how long each app is in front while you are actually using the computer
// and sends the daily totals to Valkyrie. It sees only the program's name (for example "chrome"), never window
// titles, what is on screen, or what you type.
//
//   node agent/valkyrie-agent.mjs --server http://localhost:5173 --token <secret>   first run: saves these and starts
//   node agent/valkyrie-agent.mjs                                                    afterwards: just starts
//   node agent/valkyrie-agent.mjs --install      start it quietly every time you sign in to Windows
//   node agent/valkyrie-agent.mjs --uninstall    stop doing that
//   node agent/valkyrie-agent.mjs --status       show what it has counted today
//
// Get the server address and secret from Screen Time > Computer > Set up sync in Valkyrie.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_SECONDS = 5 // how often the front app is looked at
const IDLE_SECONDS = 120 // no keyboard or mouse for this long counts as away
const SAVE_EVERY_MS = 30_000
const SEND_EVERY_MS = 60_000
const KEEP_DAYS = 7
const SEND_DAYS = 3 // days re-sent each time, so a failed send is made up for on the next one

const dir = join(process.env.APPDATA ?? process.cwd(), 'Valkyrie')
const configFile = join(dir, 'agent.json')
const usageFile = join(dir, 'agent-usage.json')
const startupFile = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Valkyrie agent.vbs')

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  renameSync(`${file}.tmp`, file)
}
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name) => process.argv.includes(`--${name}`)

if (process.platform !== 'win32') {
  console.error('This agent only works on Windows for now.')
  process.exit(1)
}

/* ---------- Startup with Windows ---------- */

if (has('install')) {
  const script = resolve(fileURLToPath(import.meta.url))
  // A tiny script in the Startup folder that runs the agent with no window.
  const vbs = `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${script}""", 0, False\r\n`
  writeFileSync(startupFile, vbs)
  console.log(`Installed. The agent will start by itself when you sign in to Windows.\n(${startupFile})`)
  process.exit(0)
}
if (has('uninstall')) {
  rmSync(startupFile, { force: true })
  console.log('Removed. The agent will no longer start by itself. Close any running copy from Task Manager (node.exe).')
  process.exit(0)
}

/* ---------- Settings ---------- */

// Settings come from the command line, or from the environment (how the "Run agent" button hands them over, so the
// secret never shows in the process list), or from the file saved the last time they were given.
const saved = readJson(configFile, {})
const given = {
  server: arg('server') ?? process.env.VALKYRIE_SERVER,
  token: arg('token') ?? process.env.VALKYRIE_TOKEN,
  device: arg('device') ?? process.env.VALKYRIE_DEVICE,
}
const config = {
  server: (given.server ?? saved.server ?? '').replace(/\/+$/, ''),
  token: given.token ?? saved.token ?? '',
  device: given.device ?? saved.device ?? hostname(),
}
if (given.server || given.token || given.device) writeJson(configFile, config)

let usage = readJson(usageFile, {}) // { 'YYYY-MM-DD': { appName: seconds } }

if (has('status')) {
  const today = usage[dayKey()] ?? {}
  const rows = Object.entries(today).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, [, n]) => s + n, 0)
  console.log(`Today on ${config.device}: ${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`)
  for (const [app, n] of rows.slice(0, 15)) console.log(`  ${app.padEnd(30)} ${Math.floor(n / 60)} min`)
  process.exit(0)
}

if (!config.server || !config.token) {
  console.error('Missing the server address or the secret. Copy the command from Screen Time > Computer > Set up sync in Valkyrie.')
  process.exit(1)
}

/* ---------- One copy at a time, and a way for Valkyrie to ask it to stop ---------- */

const pidFile = join(dir, 'agent.pid')
const stopFile = join(dir, 'agent.stop')
{
  const other = Number(readFileSync(pidFile, { encoding: 'utf8', flag: 'a+' }).trim())
  let alive = false
  if (Number.isInteger(other) && other > 0 && other !== process.pid) {
    try {
      process.kill(other, 0)
      alive = true
    } catch {
      /* not running: the file is left over */
    }
  }
  if (alive) {
    console.log('The agent is already running.')
    process.exit(0)
  }
  mkdirSync(dir, { recursive: true })
  rmSync(stopFile, { force: true })
  writeFileSync(pidFile, String(process.pid))
}

/* ---------- Watching the front app ---------- */

// Windows only tells a program which window is in front through its own API, so a small PowerShell piece asks it
// and prints "seconds since last input|program name" every few seconds.
const SAMPLER = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Front {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static uint IdleSeconds() {
    LASTINPUTINFO l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l);
    return ((uint)Environment.TickCount - l.dwTime) / 1000;
  }
  public static uint FrontPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
"@
while ($true) {
  $name = ''
  try { $name = (Get-Process -Id ([Front]::FrontPid()) -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine(([Front]::IdleSeconds()).ToString() + '|' + $name)
  Start-Sleep -Seconds ${SAMPLE_SECONDS}
}
`

const sampler = spawn(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(SAMPLER, 'utf16le').toString('base64')],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
)
sampler.stderr.on('data', (d) => {
  const text = String(d).trim()
  if (text && !text.startsWith('#< CLIXML')) log('sampler:', text) // PowerShell's own progress notes are not errors
})
sampler.on('exit', (code) => {
  log(`The sampler stopped (${code}).`)
  save()
  rmSync(pidFile, { force: true })
  process.exit(1)
})

let lastSample = Date.now()
let buffer = ''
sampler.stdout.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    const [idle, ...rest] = line.split('|')
    const app = rest.join('|').trim()
    const now = Date.now()
    // Count the real time since the last look (not more than two looks' worth, in case the PC was asleep).
    const elapsed = Math.min((now - lastSample) / 1000, SAMPLE_SECONDS * 2)
    lastSample = now
    if (!app || Number(idle) >= IDLE_SECONDS) continue
    const today = (usage[dayKey()] ??= {})
    today[app] = (today[app] ?? 0) + elapsed
  }
})

function save() {
  for (const day of Object.keys(usage)) {
    if (Date.now() - Date.parse(day) > KEEP_DAYS * 86_400_000) delete usage[day]
  }
  writeJson(usageFile, usage)
}

/* ---------- Sending ---------- */

let rejected = false
async function send() {
  const days = Object.keys(usage)
    .sort()
    .slice(-SEND_DAYS)
    .map((day) => ({
      day,
      apps: Object.entries(usage[day])
        .map(([app, seconds]) => ({ app: app.slice(0, 120), seconds: Math.min(86_400, Math.round(seconds)) }))
        .filter((a) => a.seconds > 0)
        .slice(0, 500),
    }))
    .filter((d) => d.apps.length)
  if (!days.length) return
  try {
    const res = await fetch(`${config.server}/api/screen-time/agent/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ device: config.device, days }),
    })
    if (res.ok) {
      if (rejected) log('Connected again.')
      rejected = false
    } else if (res.status === 401) {
      if (!rejected) log('Valkyrie no longer accepts this secret. Set up sync again on the Screen Time page. Still counting here.')
      rejected = true
    } else {
      log(`Valkyrie answered ${res.status}. Will try again.`)
    }
  } catch {
    log("Couldn't reach Valkyrie. Will try again.")
  }
}

setInterval(save, SAVE_EVERY_MS)
setInterval(() => void send(), SEND_EVERY_MS)
setTimeout(() => void send(), 5_000)

const stop = () => {
  save()
  sampler.kill()
  rmSync(pidFile, { force: true })
  rmSync(stopFile, { force: true })
  process.exit(0)
}
setInterval(() => existsSync(stopFile) && stop(), 1000)
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

log(`Valkyrie agent counting for "${config.device}". Sending to ${config.server}. Press Ctrl+C to stop.`)
if (!existsSync(startupFile)) log('Tip: run with --install to start it automatically when you sign in.')
