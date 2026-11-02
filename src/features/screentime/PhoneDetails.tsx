import { format, formatDistanceToNow, parseISO } from 'date-fns'
import type { PhoneDevice } from '../../types'
import type { PhonesState } from './usePhones'

/** One paired phone: when it last sent numbers, and how to remove it. Shown in a dialog. */
export function PhoneDetails({ device, phones, onRemoved }: { device: PhoneDevice; phones: PhonesState; onRemoved: () => void }) {
  const remove = async () => {
    if (!window.confirm(`Remove ${device.name}? Its screen time is removed from Valkyrie. The app on the phone stops being able to send.`)) return
    if (await phones.remove(device.id)) onRemoved()
  }
  return (
    <div>
      <p className="stat-label">
        Time in each app on your Android phone. A small Valkyrie app on the phone reads it (Android only allows that from the phone itself) and sends
        daily totals: only app names, icons and seconds.
      </p>
      <p className="stat-label">
        {device.lastSyncedAt
          ? `Synced ${formatDistanceToNow(parseISO(device.lastSyncedAt), { addSuffix: true })} (${format(parseISO(device.lastSyncedAt), 'MMM d, h:mm a')}). It updates about every half hour while the phone can reach Valkyrie. Open the app on the phone and press Sync now to update right away.`
          : 'Paired, nothing sent yet. Open the app on the phone and press Sync now.'}
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="danger" disabled={phones.busy} onClick={() => void remove()}>
          Remove this phone
        </button>
      </div>
      {phones.error && (
        <div className="banner error" role="alert" style={{ marginTop: 12 }}>
          <span>{phones.error}</span>
        </div>
      )}
    </div>
  )
}

/** The address and one-time code to type into the phone app, until a phone has paired with it. */
export function PairPhone({ phones, onDone }: { phones: PhonesState; onDone: () => void }) {
  const { pairing, justPaired } = phones
  if (!pairing) {
    return phones.error ? (
      <div className="banner error" role="alert" style={{ marginTop: 12 }}>
        <span>{phones.error}</span>
      </div>
    ) : (
      <p className="stat-label">Making a code...</p>
    )
  }
  if (justPaired) {
    return (
      <div>
        <p>
          <strong>Phone paired.</strong> It sends its first numbers in a few seconds.
        </p>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    )
  }
  return (
    <div className="device-steps">
      <ol>
        <li>
          Install the Valkyrie app on the phone (the <code>android</code> folder of this project builds it) and allow usage access when it asks.
        </li>
        <li>
          A secure <code>https</code> address works from anywhere (keep Valkyrie and ngrok running). A <code>192.168…</code> one needs the phone on the
          same Wi-Fi as this computer.
        </li>
        <li>
          In the app, type this address{pairing.addresses.length > 1 ? ' (any one of these)' : ''}:
          <div>
            {pairing.addresses.length > 0 ? (
              pairing.addresses.map((a) => (
                <div key={a}>
                  <code>{a}</code>
                </div>
              ))
            ) : (
              <em>This computer has no home network address. Is it on Wi-Fi?</em>
            )}
          </div>
        </li>
        <li>
          …and this code:{' '}
          <strong style={{ fontFamily: 'monospace', fontSize: '1.3em', letterSpacing: '0.1em' }}>{pairing.code}</strong>
        </li>
      </ol>
      <p className="stat-label">The code works once, for ten minutes. This page notices when the phone connects.</p>
      {!pairing.listening && (
        <div className="banner error" role="alert">
          <span>
            Valkyrie is only answering this computer right now, so a phone can't reach it. Add <code>HOST=0.0.0.0</code> to the <code>.env</code> file,
            restart the server, and allow it through Windows Firewall on private networks. Also set <code>ALLOW_REGISTRATION=false</code> so only you
            can sign up from the network.
          </span>
        </div>
      )}
    </div>
  )
}
