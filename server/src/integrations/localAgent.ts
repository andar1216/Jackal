import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Starts and stops the computer agent (agent/valkyrie-agent.mjs) on the machine this server runs on. Valkyrie is a
 * personal app that runs on your own computer, so "Run agent" can just start it. The agent shares a few files with the
 * server in %APPDATA%\Valkyrie: its settings, a pid file while it runs, and a stop file the server uses to ask it to stop.
 */
export type AgentStatus = {
  /** False off Windows, where the agent does not work. */
  supported: boolean
  running: boolean
  /** Whether it is set to start when the person signs in to Windows. */
  startup: boolean
}

export type AgentControl = {
  status(): AgentStatus
  start(opts: { server: string; token: string; device: string }): Promise<void>
  stop(): Promise<void>
  setStartup(enabled: boolean): void
}

const supported = process.platform === 'win32'
const appData = process.env.APPDATA ?? tmpdir()
const dir = join(appData, 'Valkyrie')
const pidFile = join(dir, 'agent.pid')
const stopFile = join(dir, 'agent.stop')
const configFile = join(dir, 'agent.json')
const startupFile = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Valkyrie agent.vbs')
const script = fileURLToPath(new URL('../../../agent/valkyrie-agent.mjs', import.meta.url))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function agentPid() {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    if (!Number.isInteger(pid) || pid <= 0) return undefined
    process.kill(pid, 0) // throws when there is no such process
    return pid
  } catch {
    return undefined
  }
}

const needWindows = () => {
  if (!supported) throw new Error('The computer agent only works on Windows for now.')
}

export const realAgentControl: AgentControl = {
  status: () => ({ supported, running: agentPid() !== undefined, startup: existsSync(startupFile) }),

  async stop() {
    const pid = agentPid()
    if (pid === undefined) return
    // Ask nicely first, so it can save what it has counted.
    mkdirSync(dir, { recursive: true })
    writeFileSync(stopFile, '')
    for (let i = 0; i < 20 && agentPid() !== undefined; i++) await sleep(250)
    rmSync(stopFile, { force: true })
    if (agentPid() !== undefined) {
      // Still there: end it and the small helper it started.
      await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve()))
    }
  },

  async start({ server, token, device }) {
    needWindows()
    await this.stop()
    // Settings go in the environment, not the command line, so the secret is not visible in the process list.
    const child = spawn(process.execPath, [script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, VALKYRIE_SERVER: server, VALKYRIE_TOKEN: token, VALKYRIE_DEVICE: device },
    })
    child.unref()
    for (let i = 0; i < 20 && agentPid() === undefined; i++) await sleep(250)
    if (agentPid() === undefined) throw new Error('The agent did not start. Is Node.js installed and is this server running on the same computer?')
  },

  setStartup(enabled) {
    needWindows()
    if (enabled && !existsSync(configFile)) throw new Error('Run the agent once first.')
    execFileSync(process.execPath, [script, enabled ? '--install' : '--uninstall'], { windowsHide: true })
  },
}

/** Tests swap this for one that does not start real programs. */
export let agentControl: AgentControl = realAgentControl
export const setAgentControl = (control: AgentControl) => {
  agentControl = control
}
