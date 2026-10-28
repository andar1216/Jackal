import { useEffect, useState } from 'react'
import { integrationsApi } from '../../lib/api'
import type { Integration } from '../../types'

const CATEGORY_LABELS: Record<Integration['category'], string> = {
  calendar: 'Calendar',
  finance: 'Finance',
  fitness: 'Fitness',
  'screen-time': 'Screen time',
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export default function ConnectModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Integration[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    integrationsApi
      .list()
      .then((list) => !cancelled && setItems(list))
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id)
    setError(null)
    try {
      await action()
      setItems(await integrationsApi.list())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const connectedCount = items?.filter((i) => i.status === 'connected').length ?? 0

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="row between">
          <div>
            <h2 id="connect-title">Connect your accounts</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {items ? `${connectedCount} of ${items.length} connected.` : 'Bring in data from other services.'} We're
              adding them one at a time.
            </p>
          </div>
          <button className="link" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>

        {error && (
          <div className="banner error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>{error}</span>
          </div>
        )}

        {!items && !error && <p className="empty">Loading...</p>}

        {items && (
          <ul className="list" style={{ marginTop: 8 }}>
            {items.map((item) => (
              <li key={item.id} className="integration-row">
                <div className="integration-info">
                  <div className="row">
                    <strong>{item.name}</strong>
                    <span className="pill">{CATEGORY_LABELS[item.category]}</span>
                    {item.status === 'connected' ? (
                      <span className="pill good-pill">Connected</span>
                    ) : (
                      !item.available && <span className="pill">Coming soon</span>
                    )}
                  </div>
                  <div className="muted">{item.description}</div>
                  {item.note && <div className="stat-label">{item.note}</div>}
                </div>
                {item.status === 'connected' ? (
                  <button disabled={busyId === item.id} onClick={() => run(item.id, () => integrationsApi.disconnect(item.id))}>
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={!item.available || busyId === item.id}
                    title={item.available ? undefined : 'Not built yet'}
                    onClick={() => run(item.id, () => integrationsApi.connect(item.id))}
                  >
                    Connect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
