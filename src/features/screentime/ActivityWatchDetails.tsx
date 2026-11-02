import { formatDistanceToNow, parseISO } from 'date-fns'
import type { ActivityWatchState } from './useActivityWatch'

/** Everything about ActivityWatch on this computer: what it is, its state, and what to press next. Shown in a dialog. */
export default function ActivityWatchDetails({ aw }: { aw: ActivityWatchState }) {
  const { status, busy, error, note } = aw
  const pill = !status ? null : status.connected ? (
    <span className="pill good-pill">Connected</span>
  ) : status.running ? (
    <span className="pill">Running</span>
  ) : (
    <span className="pill">{status.installed ? 'Not running' : 'Not installed'}</span>
  )

  return (
    <div>
      <div className="row between" style={{ marginTop: 8 }}>
        <span className="row">
          <span className="pill api-official">Recommended</span>
          {pill}
        </span>
        <span className="row">
          {status?.connected && (
            <>
              <button disabled={busy} onClick={() => void aw.sync()}>
                {busy ? 'Working...' : 'Sync now'}
              </button>
              <button className="link" disabled={busy} onClick={() => void aw.disconnect()}>
                Disconnect
              </button>
            </>
          )}
          {status && !status.connected && status.running && (
            <button className="primary" disabled={busy} onClick={() => void aw.connect()}>
              {busy ? 'Reading...' : 'Connect ActivityWatch'}
            </button>
          )}
          {status && !status.running && status.installed && (
            <button className="primary" disabled={busy} onClick={() => void aw.start()}>
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
            <span className="pill">{status.watchers.web > 0 ? 'Recording' : 'No browser extension yet'}</span>
            {status.watchers.web === 0 && (
              <a className="link" href="https://chromewebstore.google.com/search/ActivityWatch%20Web%20Watcher" target="_blank" rel="noopener noreferrer">
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
