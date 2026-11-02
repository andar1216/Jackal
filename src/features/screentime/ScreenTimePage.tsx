import { useEffect, useState } from 'react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { Monitor, Smartphone } from 'lucide-react'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import { screenTimeApi } from '../../lib/api'
import { buildMetric } from '../../lib/calendarMetrics'
import { todayKey } from '../../lib/dates'
import type { AgentStatus, Integration } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'
import { appName, formatSeconds, recentDays, topApps, totalsByDay } from './screenTimeStats'
import { useScreenTime, type ScreenTime } from './useScreenTime'

const isScreenTimeConnector = (i: Integration) => i.category === 'screen-time'

const ICON = 20
const COMPUTER_COLOR = '#16a34a'
const PHONE_COLOR = '#4f46e5'
const HISTORY_DAYS = 14

/** The agent reports about once a minute, so a computer that has been quiet for longer than this is not running it. */
const ONLINE_MS = 3 * 60 * 1000

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

function ComputerSetup({ screenTime, onDone }: { screenTime: ScreenTime; onDone: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const known = screenTime.data?.devices.length ?? 0
  const [startedWith] = useState(known)

  useEffect(() => {
    let cancelled = false
    screenTimeApi.token().then(
      (r) => !cancelled && setToken(r.token),
      (err) => !cancelled && setError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Wait for the new agent's first report.
  const { reload } = screenTime
  useEffect(() => {
    if (!token) return
    const timer = setInterval(() => void reload(), 4000)
    return () => clearInterval(timer)
  }, [token, reload])

  const command = token ? `node agent/valkyrie-agent.mjs --server ${window.location.origin} --token ${token}` : ''
  const arrived = known > startedWith

  return (
    <div className="device-steps">
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <ol>
        <li>Install Node.js on the computer if it isn't there yet (nodejs.org). The agent works on Windows.</li>
        <li>Open a terminal in the Valkyrie folder and run this. It only needs to be run once:</li>
      </ol>
      <pre className="device-command">{token ? command : 'Making your secret...'}</pre>
      <div className="row">
        <button
          disabled={!token}
          onClick={() => {
            void navigator.clipboard?.writeText(command)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy command'}
        </button>
        <span className="stat-label">
          {arrived ? 'Connected. This computer has started reporting.' : token ? 'Waiting for the computer to report...' : ''}
        </span>
      </div>
      <ol start={3}>
        <li>
          To start it by itself whenever you sign in to Windows, run <code>node agent/valkyrie-agent.mjs --install</code> once.
        </li>
      </ol>
      <p className="stat-label">
        The agent records only the name of the program in front (like "chrome") while you are using the keyboard or mouse. It never
        reads window titles, what is on screen, or what you type. The secret above is shown once; setting up again makes a new one and
        the old install stops being accepted.
      </p>
      <button className="link" onClick={onDone}>
        Close
      </button>
    </div>
  )
}

function ComputerCard({ screenTime }: { screenTime: ScreenTime }) {
  const [byCommand, setByCommand] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const devices = (screenTime.data?.devices ?? []).filter((d) => d.kind === 'computer')

  // Whether the agent is running right now, checked now and every few seconds.
  useEffect(() => {
    let cancelled = false
    const look = () =>
      screenTimeApi.agent().then(
        (a) => !cancelled && setAgent(a),
        () => undefined,
      )
    void look()
    const timer = setInterval(() => void look(), 10_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const act = async (job: () => Promise<AgentStatus>) => {
    setBusy(true)
    setError(null)
    try {
      setAgent(await job())
      await screenTime.reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string) => {
    if (!window.confirm(`Stop tracking ${name}? What it sent to Valkyrie is deleted too.`)) return
    try {
      await screenTimeApi.removeDevice(name)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const running = agent?.running ?? false
  return (
    <div className="device">
      <div className="row between">
        <span className="row">
          <Monitor size={ICON} aria-hidden />
          <strong>Computer</strong>
          {running ? <span className="pill good-pill">Agent running</span> : <span className="pill">{devices.length === 0 ? 'Not synced' : 'Agent stopped'}</span>}
        </span>
        {agent?.supported !== false && (
          <button
            className={running ? undefined : 'primary'}
            disabled={busy || !agent}
            onClick={() => void act(running ? screenTimeApi.stopAgent : screenTimeApi.startAgent)}
          >
            {busy ? 'Working...' : running ? 'Stop agent' : 'Run agent'}
          </button>
        )}
      </div>
      <p className="stat-label">
        Time in each app while you are using the computer. "Run agent" starts a small background program on this computer; nothing to type.
      </p>
      {agent?.supported === false && <p className="stat-label">The agent only works on Windows for now.</p>}
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {agent?.supported !== false && (devices.length > 0 || running) && (
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={agent?.startup ?? false}
            disabled={busy || !agent}
            onChange={(e) => void act(() => screenTimeApi.setStartup(e.target.checked))}
          />
          <span>Start the agent when I sign in to Windows</span>
        </label>
      )}
      {devices.length > 0 && (
        <ul className="list">
          {devices.map((d) => {
            const seen = d.lastSeenAt ? Date.parse(d.lastSeenAt) : 0
            const online = screenTime.fetchedAt - seen < ONLINE_MS
            return (
              <li key={d.name}>
                <span>
                  {d.name}
                  <br />
                  <span className="stat-label">
                    {d.lastSeenAt ? `Synced ${formatDistanceToNow(parseISO(d.lastSeenAt), { addSuffix: true })}` : 'No report yet'}
                  </span>
                </span>
                <span className="row">
                  <span className={`pill ${online ? 'good-pill' : ''}`}>{online ? 'Reporting' : 'Quiet'}</span>
                  <button className="link" aria-label={`Stop tracking ${d.name}`} onClick={() => void remove(d.name)}>
                    ✕
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <button className="link" onClick={() => setByCommand(!byCommand)} aria-expanded={byCommand}>
        {byCommand ? 'Hide the command' : "Valkyrie runs on another computer? Set up with a command"}
      </button>
      {byCommand && <ComputerSetup screenTime={screenTime} onDone={() => setByCommand(false)} />}
    </div>
  )
}
function PhoneCard() {
  const [open, setOpen] = useState(false)
  return (
    <div className="device">
      <div className="row between">
        <span className="row">
          <Smartphone size={ICON} aria-hidden />
          <strong>Phone</strong>
          <span className="pill">Not synced</span>
        </span>
        <span className="row">
          <button onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide steps' : 'Set up sync'}
          </button>
          <button className="primary" disabled title="Available once a phone is set up">
            Sync now
          </button>
        </span>
      </div>
      <p className="stat-label">Screen-on time and time in each app.</p>
      {open && (
        <div className="device-steps">
          <ol>
            <li>Install the Valkyrie companion app on your phone.</li>
            <li>Allow it to read app usage when the phone asks.</li>
            <li>Sign in with your Valkyrie account. It sends your daily totals after that.</li>
          </ol>
          <p className="stat-label">Phone syncing is not switched on yet. Nothing is sent from your phone until it is.</p>
        </div>
      )}
    </div>
  )
}

export default function ScreenTimePage() {
  const layout = useLayoutEditing()
  const screenTime = useScreenTime()
  const [appDays, setAppDays] = useState(1)

  const usage = screenTime.data?.usage ?? []
  const byDay = totalsByDay(usage)
  const today = todayKey()
  const computerToday = byDay[today] ?? 0
  const hasComputer = (screenTime.data?.devices.length ?? 0) > 0

  const apps = topApps(usage, appDays).slice(0, 10)
  const appsTotal = apps.reduce((s, a) => s + a.seconds, 0)
  const history = recentDays(byDay, HISTORY_DAYS)
  const busiest = Math.max(1, ...history.map((h) => h.seconds))

  const metrics = [
    buildMetric(
      { id: 'computer', label: 'Computer screen time', color: COMPUTER_COLOR, format: formatSeconds },
      Object.entries(byDay),
      ([day, seconds]) => ({ day, amount: seconds, line: `Computer · ${formatSeconds(seconds)}` }),
    ),
    buildMetric({ id: 'phone', label: 'Phone screen time', color: PHONE_COLOR, format: formatSeconds }, [] as [string, number][], ([day, seconds]) => ({
      day,
      amount: seconds,
    })),
  ]

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Screen Time</h1>
          <p>Time on your computer and your phone. Sync a device to start tracking.</p>
        </div>
        <div className="row">
          <PanelFilter page="screentime" />
          <ConnectorsButton filter={isScreenTimeConnector} title="Screen time connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

      <Board page="screentime" editing={layout.editing} onEditingChange={layout.setEditing}>
        <Panel id="today-computer" title="Computer today" size="third">
          <div className="card">
            <div className="stat-label">Computer today</div>
            <div className="stat-value">{hasComputer ? formatSeconds(computerToday) : '--'}</div>
            <p className="stat-label">{hasComputer ? 'While using it' : 'No data yet'}</p>
          </div>
        </Panel>

        <Panel id="today-phone" title="Phone today" size="third">
          <div className="card">
            <div className="stat-label">Phone today</div>
            <div className="stat-value">--</div>
            <p className="stat-label">No data yet</p>
          </div>
        </Panel>

        <Panel id="today-total" title="Total today" size="third">
          <div className="card">
            <div className="stat-label">Total today</div>
            <div className="stat-value">{hasComputer ? formatSeconds(computerToday) : '--'}</div>
            <p className="stat-label">{hasComputer ? 'All synced devices' : 'No data yet'}</p>
          </div>
        </Panel>

        <Panel id="devices" title="Devices" size="full">
          <section className="card">
            <h2>Devices</h2>
            <div className="device-list">
              <ComputerCard screenTime={screenTime} />
              <PhoneCard />
            </div>
          </section>
        </Panel>

        <Panel id="apps" title="Most used apps" size="half">
          <section className="card">
            <div className="row between">
              <h2>Most used apps</h2>
              <select aria-label="Period" value={appDays} onChange={(e) => setAppDays(Number(e.target.value))}>
                <option value={1}>Today</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>
            {apps.length === 0 ? (
              <p className="empty">{hasComputer ? 'Nothing counted for this period yet.' : 'Sync a device to see which apps take your time.'}</p>
            ) : (
              <ul className="list">
                {apps.map((a) => (
                  <li key={a.app}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {appName(a.app)}
                      <div className="bar">
                        <span style={{ width: `${(a.seconds / appsTotal) * 100}%` }} />
                      </div>
                    </span>
                    <strong>{formatSeconds(a.seconds)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>

        <Panel id="history" title="Daily history" size="half">
          <section className="card">
            <h2>Daily history</h2>
            {!hasComputer ? (
              <p className="empty">Sync a device to see your day-by-day totals.</p>
            ) : (
              <ul className="list">
                {history.map((h) => (
                  <li key={h.key}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {format(h.date, 'EEE, MMM d')}
                      <div className="bar">
                        <span style={{ width: `${(h.seconds / busiest) * 100}%` }} />
                      </div>
                    </span>
                    <strong>{h.seconds > 0 ? formatSeconds(h.seconds) : '--'}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>

        <Panel id="calendar" title="Calendar" size="full">
          <MetricCalendar metrics={metrics} />
        </Panel>
      </Board>
    </>
  )
}
