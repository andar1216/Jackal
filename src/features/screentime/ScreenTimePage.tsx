import { useEffect, useState } from 'react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { Activity, Smartphone } from 'lucide-react'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import { activityWatchApi, integrationsApi } from '../../lib/api'
import { buildMetric } from '../../lib/calendarMetrics'
import { todayKey } from '../../lib/dates'
import type { ActivityWatchStatus, Integration } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'
import ItemIcon from './ItemIcon'
import { appName, formatSeconds, recentDays, topApps, topSites, totalsByDay } from './screenTimeStats'
import { useScreenTime, type ScreenTime } from './useScreenTime'

const isScreenTimeConnector = (i: Integration) => i.category === 'screen-time'

const ICON = 20
const COMPUTER_COLOR = '#16a34a'
const PHONE_COLOR = '#4f46e5'
const HISTORY_DAYS = 14


const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

function ActivityWatchCard({ screenTime }: { screenTime: ScreenTime }) {
  const [status, setStatus] = useState<ActivityWatchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Whether ActivityWatch is running and connected, checked now and every few seconds.
  useEffect(() => {
    let cancelled = false
    const look = () =>
      activityWatchApi.status().then(
        (s) => !cancelled && setStatus(s),
        () => undefined,
      )
    void look()
    const timer = setInterval(() => void look(), 10_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const { reload } = screenTime
  const act = async (job: () => Promise<{ status: ActivityWatchStatus; apps: number; sites: number } | ActivityWatchStatus>, done?: (apps: number, sites: number) => string) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const r = await job()
      if ('status' in r) {
        setStatus(r.status)
        if (done) setNote(done(r.apps, r.sites))
      } else {
        setStatus(r)
      }
      await reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect ActivityWatch? The numbers Valkyrie read from it are removed here (ActivityWatch keeps its own).')) return
    setBusy(true)
    try {
      await integrationsApi.disconnect('activitywatch')
      setStatus(await activityWatchApi.status())
      await reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const read = (apps: number, sites: number) => `Read ${apps} app totals and ${sites} website totals.`
  const pill = !status ? null : status.connected ? (
    <span className="pill good-pill">Connected</span>
  ) : status.running ? (
    <span className="pill">Running</span>
  ) : (
    <span className="pill">{status.installed ? 'Not running' : 'Not installed'}</span>
  )

  return (
    <div className="device">
      <div className="row between">
        <span className="row">
          <Activity size={ICON} aria-hidden />
          <strong>ActivityWatch</strong>
          <span className="pill api-official">Recommended</span>
          {pill}
        </span>
        <span className="row">
          {status?.connected && (
            <>
              <button disabled={busy} onClick={() => void act(activityWatchApi.sync, read)}>
                {busy ? 'Working...' : 'Sync now'}
              </button>
              <button className="link" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          )}
          {status && !status.connected && status.running && (
            <button className="primary" disabled={busy} onClick={() => void act(activityWatchApi.connect, read)}>
              {busy ? 'Reading...' : 'Connect ActivityWatch'}
            </button>
          )}
          {status && !status.running && status.installed && (
            <button className="primary" disabled={busy} onClick={() => void act(activityWatchApi.start)}>
              {busy ? 'Starting...' : 'Start ActivityWatch'}
            </button>
          )}
          {status && !status.running && !status.installed && (
            <a className="button-link primary" href="https://activitywatch.net/downloads/" target="_blank" rel="noopener noreferrer">
              Download ActivityWatch ↗
            </a>
          )}
        </span>
      </div>
      <p className="stat-label">
        A free, open-source tracker that runs on this computer: time in each app, and on each website with its browser extension. Valkyrie
        reads its daily totals and keeps only app and site names and seconds.
      </p>
      {status && !status.running && !status.installed && (
        <p className="stat-label">Install it, make sure it is running (it lives in the system tray), then come back here. This page notices by itself.</p>
      )}
      {status?.connected && (
        <p className="stat-label">
          {status.lastSyncedAt ? `Synced ${formatDistanceToNow(parseISO(status.lastSyncedAt), { addSuffix: true })}. ` : ''}
          Updates by itself every few minutes while Valkyrie is running.
        </p>
      )}
      {status?.running && status.watchers && (
        <ul className="list">
          <li>
            <span>Apps</span>
            <span className="pill">{status.watchers.window ? 'Recording' : 'No data yet'}</span>
          </li>
          <li>
            <span>Away from keyboard detection</span>
            <span className="pill">{status.watchers.afk ? 'On' : 'Off: idle time will be counted'}</span>
          </li>
          <li>
            <span>Websites</span>
            <span className="pill">
              {status.watchers.web > 0 ? 'Recording' : 'No browser extension yet'}
            </span>
            {status.watchers.web === 0 && (
              <a
                className="link"
                href="https://chromewebstore.google.com/search/ActivityWatch%20Web%20Watcher"
                target="_blank"
                rel="noopener noreferrer"
              >
                Add the Chrome extension ↗
              </a>
            )}
          </li>
        </ul>
      )}
      {note && <p className="stat-label">{note}</p>}
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}
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
  const [siteDays, setSiteDays] = useState(1)

  const usage = screenTime.data?.usage ?? []
  const byDay = totalsByDay(usage)
  const today = todayKey()
  const computerToday = byDay[today] ?? 0
  const hasComputer = usage.length > 0 || (screenTime.data?.sites.length ?? 0) > 0

  const sites = topSites(screenTime.data?.sites ?? [], siteDays).slice(0, 10)
  const sitesTotal = sites.reduce((s, a) => s + a.seconds, 0)
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
          <p>Time on your computer and your phone. Connect ActivityWatch to start tracking this computer.</p>
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
              <ActivityWatchCard screenTime={screenTime} />
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
              <p className="empty">{hasComputer ? 'Nothing counted for this period yet.' : 'Connect ActivityWatch to see which apps take your time.'}</p>
            ) : (
              <ul className="list">
                {apps.map((a) => (
                  <li key={a.app}>
                    <ItemIcon kind="app" name={a.app} label={appName(a.app)} />
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

        <Panel id="websites" title="Websites" size="half">
          <section className="card">
            <div className="row between">
              <h2>Websites</h2>
              <select aria-label="Period" value={siteDays} onChange={(e) => setSiteDays(Number(e.target.value))}>
                <option value={1}>Today</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>
            {sites.length === 0 ? (
              <p className="empty">Connect ActivityWatch and add its browser extension to see which websites take your time.</p>
            ) : (
              <ul className="list">
                {sites.map((s) => (
                  <li key={s.site}>
                    <ItemIcon kind="site" name={s.site} label={s.site} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {s.site}
                      <div className="bar">
                        <span style={{ width: `${(s.seconds / sitesTotal) * 100}%` }} />
                      </div>
                    </span>
                    <strong>{formatSeconds(s.seconds)}</strong>
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
              <p className="empty">Connect ActivityWatch to see your day-by-day totals.</p>
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
