import { useState, type ReactNode } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import Board, { Panel } from '../../components/Board'
import MetricCalendar from '../../components/MetricCalendar'
import PanelFilter from '../../components/PanelFilter'
import SettingsMenu from '../../components/SettingsMenu'
import { useLayoutEditing } from '../../components/useLayoutEditing'
import { buildMetric } from '../../lib/calendarMetrics'
import type { Integration } from '../../types'
import ConnectorsButton from '../connections/ConnectorsButton'

const isScreenTimeConnector = (i: Integration) => i.category === 'screen-time'

const ICON = 20

type Device = {
  id: 'phone' | 'computer'
  name: string
  icon: ReactNode
  /** What gets installed and what it can see, in plain words. */
  summary: string
  steps: string[]
  color: string
}

const DEVICES: Device[] = [
  {
    id: 'phone',
    name: 'Phone',
    icon: <Smartphone size={ICON} aria-hidden />,
    summary: 'Screen-on time and time in each app.',
    steps: [
      'Install the Jackal companion app on your phone.',
      'Allow it to read app usage when the phone asks.',
      'Sign in with your Jackal account. It sends your daily totals after that.',
    ],
    color: '#4f46e5',
  },
  {
    id: 'computer',
    name: 'Computer',
    icon: <Monitor size={ICON} aria-hidden />,
    summary: 'Time in each app and in the active window.',
    steps: [
      'Install the Jackal agent on your computer.',
      'Sign in with your Jackal account.',
      'Leave it running in the background. It sends your daily totals.',
    ],
    color: '#16a34a',
  },
]

function DeviceCard({ device }: { device: Device }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="device">
      <div className="row between">
        <span className="row">
          <span aria-hidden>{device.icon}</span>
          <strong>{device.name}</strong>
          <span className="pill">Not synced</span>
        </span>
        <span className="row">
          <button onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide steps' : 'Set up sync'}
          </button>
          <button className="primary" disabled title="Available once a device is set up">
            Sync now
          </button>
        </span>
      </div>
      <p className="stat-label">{device.summary}</p>
      {open && (
        <div className="device-steps">
          <ol>
            {device.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="stat-label">Syncing is not switched on yet. Nothing is sent from your {device.name.toLowerCase()} until it is.</p>
        </div>
      )}
    </div>
  )
}

export default function ScreenTimePage() {
  const layout = useLayoutEditing()

  // No device sends data yet, so these are empty. They are ready for when one does.
  const minutes = (n: number) => `${Math.floor(n / 60)}h ${n % 60}m`
  const metrics = DEVICES.map((d) =>
    buildMetric({ id: d.id, label: `${d.name} screen time`, color: d.color, format: minutes }, [] as { day: string; min: number }[], (e) => ({
      day: e.day,
      amount: e.min,
    })),
  )

  return (
    <>
      <header className="page-header row between">
        <div>
          <h1>Screen Time</h1>
          <p>Time on your phone and your computer. Sync a device to start tracking.</p>
        </div>
        <div className="row">
          <PanelFilter page="screentime" />
          <ConnectorsButton filter={isScreenTimeConnector} title="Screen time connectors" />
          <SettingsMenu items={[layout.item]} />
        </div>
      </header>

      <Board page="screentime" editing={layout.editing} onEditingChange={layout.setEditing}>
        {DEVICES.map((d) => (
          <Panel key={d.id} id={`today-${d.id}`} title={`${d.name} today`} size="third">
            <div className="card">
              <div className="stat-label">{d.name} today</div>
              <div className="stat-value">--</div>
              <p className="stat-label">No data yet</p>
            </div>
          </Panel>
        ))}

        <Panel id="today-total" title="Total today" size="third">
          <div className="card">
            <div className="stat-label">Total today</div>
            <div className="stat-value">--</div>
            <p className="stat-label">No data yet</p>
          </div>
        </Panel>

        <Panel id="devices" title="Devices" size="full">
          <section className="card">
            <h2>Devices</h2>
            <div className="device-list">
              {DEVICES.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </div>
          </section>
        </Panel>

        <Panel id="apps" title="Most used apps" size="half">
          <section className="card">
            <h2>Most used apps</h2>
            <p className="empty">Sync a device to see which apps take your time.</p>
          </section>
        </Panel>

        <Panel id="history" title="Daily history" size="half">
          <section className="card">
            <h2>Daily history</h2>
            <p className="empty">Sync a device to see your day-by-day totals.</p>
          </section>
        </Panel>

        <Panel id="calendar" title="Calendar" size="full">
          <MetricCalendar metrics={metrics} />
        </Panel>
      </Board>
    </>
  )
}
