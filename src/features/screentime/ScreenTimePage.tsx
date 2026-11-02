import { useState } from 'react'
import { format } from 'date-fns'
import { Smartphone } from 'lucide-react'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import { buildMetric } from '../../lib/calendarMetrics'
import { todayKey } from '../../lib/dates'
import type { Integration } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'
import { MAX_DAYS, MAX_ITEMS, amountOf, useAmount } from './amount'
import AmountSelect from './AmountSelect'
import DevicesPanel from './DevicesPanel'
import DeviceViewsBar from './DeviceViewsBar'
import { devicesIn, resolveView } from './deviceViews'
import ItemIcon from './ItemIcon'
import { appName, countsByDay, formatCompact, formatSeconds, ofKind, recentDays, topApps, topNotifiers, topSites, totalsByDay } from './screenTimeStats'
import { useDeviceGroups, useDeviceView } from './useDeviceViews'
import { useScreenTime } from './useScreenTime'

const isScreenTimeConnector = (i: Integration) => i.category === 'screen-time'

const COMPUTER_COLOR = '#16a34a'
const PHONE_COLOR = '#4f46e5'
const UNLOCKS_COLOR = '#f59e0b'
const NOTIFICATIONS_COLOR = '#e11d48'

// What the drop-downs offer. "Custom" is added to each by the control itself.
const COUNTS = [
  { value: '3', label: 'Top 3' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '20', label: 'Top 20' },
  { value: 'all', label: 'All' },
]
const PERIODS = [
  { value: '1', label: 'Today' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
]
const HISTORY_RANGES = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
]

export default function ScreenTimePage() {
  const layout = useLayoutEditing()
  const screenTime = useScreenTime()
  // Each list remembers how many items and how many days its owner likes to see.
  const [appCount, setAppCount] = useAmount('apps-count', '10', COUNTS, { start: 15, max: MAX_ITEMS })
  const [appPeriod, setAppPeriod] = useAmount('apps-period', '1', PERIODS, { start: 14, max: MAX_DAYS })
  const [siteCount, setSiteCount] = useAmount('sites-count', '10', COUNTS, { start: 15, max: MAX_ITEMS })
  const [sitePeriod, setSitePeriod] = useAmount('sites-period', '1', PERIODS, { start: 14, max: MAX_DAYS })
  const [historyRange, setHistoryRange] = useAmount('history', '14', HISTORY_RANGES, { start: 21, max: MAX_DAYS })
  const [notifyCount, setNotifyCount] = useAmount('notifications-count', '10', COUNTS, { start: 15, max: MAX_ITEMS })
  const [notifyPeriod, setNotifyPeriod] = useAmount('notifications-period', '1', PERIODS, { start: 14, max: MAX_DAYS })

  // What the page shows: all devices, one, or a group, as chosen in the bar at the top.
  const [error, setError] = useState<string | null>(null)
  const [viewChoice, chooseView] = useDeviceView()
  const { groups, saved: groupSaved, deleted: groupDeleted } = useDeviceGroups()
  const sentUsage = screenTime.data?.usage ?? []
  const sentSites = screenTime.data?.sites ?? []
  const devices = devicesIn(sentUsage, sentSites)
  const view = resolveView(viewChoice, devices, groups)
  const usage = sentUsage.filter((u) => view.includes(u.device))
  const siteRows = sentSites.filter((s) => view.includes(s.device))
  const phoneDays = (screenTime.data?.phoneDays ?? []).filter((p) => view.includes(p.device))
  const countsByDayMap = countsByDay(phoneDays)
  const neverSent = sentUsage.length === 0 && sentSites.length === 0
  const computerByDay = totalsByDay(ofKind(usage, 'computer'))
  const phoneByDay = totalsByDay(ofKind(usage, 'phone'))
  const byDay = totalsByDay(usage) // both together
  const today = todayKey()
  const computerToday = computerByDay[today] ?? 0
  const phoneToday = phoneByDay[today] ?? 0
  const hasComputer = usage.some((u) => u.kind === 'computer') || siteRows.length > 0
  const hasPhone = usage.some((u) => u.kind === 'phone')
  const hasAny = hasComputer || hasPhone

  const sites = topSites(siteRows, amountOf(sitePeriod)).slice(0, amountOf(siteCount))
  const sitesTotal = sites.reduce((s, a) => s + a.seconds, 0)
  const apps = topApps(usage, amountOf(appPeriod)).slice(0, amountOf(appCount))
  const appsTotal = apps.reduce((s, a) => s + a.seconds, 0)
  const history = recentDays(byDay, amountOf(historyRange))
  const busiest = Math.max(1, ...history.map((h) => h.seconds))
  const notifiers = topNotifiers(phoneDays, amountOf(notifyPeriod)).slice(0, amountOf(notifyCount))
  const notifiersTotal = notifiers.reduce((s, n) => s + n.count, 0)
  const unlocksToday = countsByDayMap[today]?.unlocks
  const notificationsToday = countsByDayMap[today]?.notifications

  const metrics = [
    buildMetric(
      { id: 'computer', label: 'Computer screen time', color: COMPUTER_COLOR, format: formatSeconds },
      Object.entries(computerByDay),
      ([day, seconds]) => ({ day, amount: seconds, line: `Computer · ${formatSeconds(seconds)}` }),
    ),
    buildMetric(
      { id: 'phone', label: 'Phone screen time', color: PHONE_COLOR, format: formatSeconds },
      Object.entries(phoneByDay),
      ([day, seconds]) => ({ day, amount: seconds, line: `Phone · ${formatSeconds(seconds)}` }),
    ),
    buildMetric(
      { id: 'unlocks', label: 'Phone unlocks', color: UNLOCKS_COLOR, format: (n) => `${n} unlock${n === 1 ? '' : 's'}`, off: true },
      Object.entries(countsByDayMap),
      ([day, c]) => (c.unlocks > 0 ? { day, amount: c.unlocks, line: `Phone unlocked ${c.unlocks} time${c.unlocks === 1 ? '' : 's'}` } : undefined),
    ),
    buildMetric(
      { id: 'notifications', label: 'Phone notifications', color: NOTIFICATIONS_COLOR, format: (n) => `${n} notification${n === 1 ? '' : 's'}`, off: true },
      Object.entries(countsByDayMap),
      ([day, c]) => (c.notifications > 0 ? { day, amount: c.notifications, line: `${c.notifications} notification${c.notifications === 1 ? '' : 's'}` } : undefined),
    ),
  ]

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Screen Time</h1>
          <p>Time on your computer and your phone. Connect ActivityWatch for this computer and pair the Valkyrie app for your phone.</p>
        </div>
        <div className="row">
          <PanelFilter page="screentime" />
          <ConnectorsButton filter={isScreenTimeConnector} title="Screen time connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <DeviceViewsBar
        devices={devices}
        groups={groups}
        activeKey={view.key}
        onSelect={chooseView}
        onSaved={groupSaved}
        onDeleted={groupDeleted}
        onError={setError}
      />

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
            <div className="stat-value">{hasPhone ? formatSeconds(phoneToday) : '--'}</div>
            <p className="stat-label">{hasPhone ? 'Screen on, in apps' : 'No data yet'}</p>
          </div>
        </Panel>

        <Panel id="today-total" title="Total today" size="third">
          <div className="card">
            <div className="stat-label">Total today</div>
            <div className="stat-value">{hasAny ? formatSeconds(computerToday + phoneToday) : '--'}</div>
            <p className="stat-label">{hasAny ? (view.label ?? 'All synced devices') : 'No data yet'}</p>
          </div>
        </Panel>

        <Panel id="unlocks-today" title="Phone unlocks today" size="half">
          <div className="card">
            <div className="stat-label">Phone unlocks today</div>
            <div className="stat-value">{unlocksToday === undefined ? '--' : unlocksToday}</div>
            <p className="stat-label">{unlocksToday === undefined ? 'No data yet' : 'Times the lock screen was opened'}</p>
          </div>
        </Panel>

        <Panel id="notifications-today" title="Phone notifications today" size="half">
          <div className="card">
            <div className="stat-label">Phone notifications today</div>
            <div className="stat-value">{notificationsToday === undefined ? '--' : notificationsToday}</div>
            <p className="stat-label">{notificationsToday === undefined ? 'No data yet' : 'Notifications that reached you'}</p>
          </div>
        </Panel>

        <Panel id="devices" title="Devices" size="full">
          <DevicesPanel screenTime={screenTime} />
        </Panel>

        <Panel id="apps" title="Most used apps" size="half">
          <section className="card">
            <div className="row between">
              <h2>Most used apps</h2>
              <span className="row">
                <AmountSelect label="Apps to show" options={COUNTS} amount={appCount} onChange={setAppCount} unit="apps" max={MAX_ITEMS} />
                <AmountSelect label="Period" options={PERIODS} amount={appPeriod} onChange={setAppPeriod} unit="days" max={MAX_DAYS} />
              </span>
            </div>
            {apps.length === 0 ? (
              <p className="empty">{!neverSent ? 'Nothing counted for this period yet.' : 'Connect ActivityWatch or pair your phone to see which apps take your time.'}</p>
            ) : (
              <ul className="list">
                {apps.map((a) => (
                  <li key={`${a.kind}:${a.app}`}>
                    <ItemIcon kind="app" name={a.app} label={a.kind === 'phone' ? a.app : appName(a.app)} source={a.kind === 'phone' ? 'phone' : undefined} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {a.kind === 'phone' ? a.app : appName(a.app)}
                      {a.kind === 'phone' && <Smartphone size={13} aria-label="On your phone" style={{ marginLeft: 6, verticalAlign: '-2px', opacity: 0.6 }} />}
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
              <span className="row">
                <AmountSelect label="Websites to show" options={COUNTS} amount={siteCount} onChange={setSiteCount} unit="sites" max={MAX_ITEMS} />
                <AmountSelect label="Period" options={PERIODS} amount={sitePeriod} onChange={setSitePeriod} unit="days" max={MAX_DAYS} />
              </span>
            </div>
            {sites.length === 0 ? (
              <p className="empty">{neverSent ? 'Connect ActivityWatch and add its browser extension to see which websites take your time.' : 'No websites for this view and period yet.'}</p>
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
            <div className="row between">
              <h2>Daily history</h2>
              <AmountSelect label="Days to show" options={HISTORY_RANGES} amount={historyRange} onChange={setHistoryRange} unit="days" max={MAX_DAYS} />
            </div>
            {!hasAny ? (
              <p className="empty">{neverSent ? 'Connect ActivityWatch or pair your phone to see your day-by-day totals.' : 'No numbers from this view yet.'}</p>
            ) : (
              <ul className="list">
                {history.map((h) => (
                  <li key={h.key}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {format(h.date, 'EEE, MMM d')}
                      {countsByDayMap[h.key] && (
                        <span className="stat-label" style={{ marginLeft: 8 }}>
                          {countsByDayMap[h.key].unlocks} unlocks · {countsByDayMap[h.key].notifications} notifications
                        </span>
                      )}
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

        <Panel id="notifiers" title="Notifications by app" size="half">
          <section className="card">
            <div className="row between">
              <h2>Notifications by app</h2>
              <span className="row">
                <AmountSelect label="Apps to show" options={COUNTS} amount={notifyCount} onChange={setNotifyCount} unit="apps" max={MAX_ITEMS} />
                <AmountSelect label="Period" options={PERIODS} amount={notifyPeriod} onChange={setNotifyPeriod} unit="days" max={MAX_DAYS} />
              </span>
            </div>
            {notifiers.length === 0 ? (
              <p className="empty">{phoneDays.length === 0 ? 'Update the Valkyrie phone app and sync to see which apps notify you.' : 'No notifications for this period yet.'}</p>
            ) : (
              <ul className="list">
                {notifiers.map((n) => (
                  <li key={n.app}>
                    <ItemIcon kind="app" name={n.app} label={n.app} source="phone" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {n.app}
                      <div className="bar">
                        <span style={{ width: `${(n.count / notifiersTotal) * 100}%` }} />
                      </div>
                    </span>
                    <strong>{n.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>

        <Panel id="calendar" title="Calendar" size="full">
          <MetricCalendar
            metrics={metrics}
            // Each day with numbers shows how long it was: the total of whichever of computer and phone are switched on.
            dayLabel={(day, shown) => {
              const seconds = shown.filter((m) => m.id === 'computer' || m.id === 'phone').reduce((sum, m) => sum + (m.byDay[day] ?? 0), 0)
              return seconds > 0 ? formatCompact(seconds) : undefined
            }}
          />
        </Panel>
      </Board>
    </>
  )
}
