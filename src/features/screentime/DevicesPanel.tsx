import { useState, type ReactNode } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Activity, ChevronRight, Plus, Smartphone } from 'lucide-react'
import ActivityWatchDetails from './ActivityWatchDetails'
import DeviceModal from './DeviceModal'
import { PairPhone, PhoneDetails } from './PhoneDetails'
import { useActivityWatch } from './useActivityWatch'
import { usePhones } from './usePhones'
import type { ScreenTime } from './useScreenTime'

const ICON = 20

type View = { kind: 'add' } | { kind: 'computer' } | { kind: 'phone'; id: string } | { kind: 'pair' } | null

const ago = (iso: string) => `Synced ${formatDistanceToNow(parseISO(iso), { addSuffix: true })}`

/** One line in the list (or in the add dialog): press it to open that device. */
function DeviceRow({ icon, name, detail, pill, onOpen }: { icon: ReactNode; name: string; detail: string; pill?: ReactNode; onOpen: () => void }) {
  return (
    <button className="device device-row" onClick={onOpen}>
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="row" style={{ gap: 8 }}>
          <strong>{name}</strong>
          {pill}
        </span>
        <span className="stat-label" style={{ display: 'block' }}>
          {detail}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden style={{ opacity: 0.5 }} />
    </button>
  )
}

/**
 * The Devices panel: the computer and phones that are sending screen time, as short rows. A row opens a dialog with its
 * details; the + at the top right adds a device.
 */
export default function DevicesPanel({ screenTime }: { screenTime: ScreenTime }) {
  const aw = useActivityWatch(screenTime)
  const phones = usePhones(screenTime)
  const [view, setView] = useState<View>(null)
  const close = () => {
    if (view?.kind === 'pair') phones.closePairing()
    phones.clearError()
    setView(null)
  }

  const computer = aw.status?.connected ? aw.status : null
  const phone = view?.kind === 'phone' ? phones.devices.find((d) => d.id === view.id) : undefined

  const computerState = !aw.status
    ? 'Checking...'
    : aw.status.connected
      ? 'Already connected'
      : aw.status.running
        ? 'ActivityWatch is running: ready to connect'
        : aw.status.installed
          ? 'ActivityWatch is installed but not running'
          : 'Needs ActivityWatch, a free tracker'

  return (
    <section className="card">
      <div className="row between">
        <h2>Devices</h2>
        <button className="icon-btn" onClick={() => setView({ kind: 'add' })} aria-label="Add a device" title="Add a device">
          <Plus size={18} aria-hidden />
        </button>
      </div>

      <div className="device-list">
        {computer && (
          <DeviceRow
            icon={<Activity size={ICON} aria-hidden />}
            name={computer.hostname || 'This computer'}
            pill={<span className="pill good-pill">ActivityWatch</span>}
            detail={computer.lastSyncedAt ? ago(computer.lastSyncedAt) : 'Connected'}
            onOpen={() => setView({ kind: 'computer' })}
          />
        )}
        {phones.devices.map((d) => (
          <DeviceRow
            key={d.id}
            icon={<Smartphone size={ICON} aria-hidden />}
            name={d.name}
            pill={<span className="pill good-pill">Phone</span>}
            detail={d.lastSyncedAt ? ago(d.lastSyncedAt) : 'Paired, nothing sent yet'}
            onOpen={() => setView({ kind: 'phone', id: d.id })}
          />
        ))}
        {aw.status && !computer && phones.devices.length === 0 && (
          <p className="empty">No devices yet. Press + to add your computer or your phone.</p>
        )}
      </div>

      {view?.kind === 'add' && (
        <DeviceModal title="Add a device" onClose={close}>
          <p className="stat-label">What do you want to track?</p>
          <div className="device-list">
            <DeviceRow
              icon={<Activity size={ICON} aria-hidden />}
              name="This computer"
              detail={`ActivityWatch · ${computerState}`}
              onOpen={() => setView({ kind: 'computer' })}
            />
            <DeviceRow
              icon={<Smartphone size={ICON} aria-hidden />}
              name="Android phone"
              detail="The Valkyrie app · pair with a code"
              onOpen={() => {
                void phones.makeCode()
                setView({ kind: 'pair' })
              }}
            />
          </div>
        </DeviceModal>
      )}

      {view?.kind === 'computer' && (
        <DeviceModal title={computer?.hostname || 'This computer'} onClose={close}>
          <ActivityWatchDetails aw={aw} />
        </DeviceModal>
      )}

      {view?.kind === 'phone' && phone && (
        <DeviceModal title={phone.name} onClose={close}>
          <PhoneDetails device={phone} phones={phones} onRemoved={close} />
        </DeviceModal>
      )}

      {view?.kind === 'pair' && (
        <DeviceModal title="Pair an Android phone" onClose={close}>
          <PairPhone phones={phones} onDone={close} />
        </DeviceModal>
      )}
    </section>
  )
}
