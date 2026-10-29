import { useEffect, useRef, useState } from 'react'
import { integrationsApi, plaidApi } from '../../lib/api'
import type { Integration } from '../../types'
import PlaidLauncher from './PlaidLauncher'
import { clearLinkToken, importNewBank, saveLinkToken } from './plaidImport'

const CATEGORY_LABELS: Record<Integration['category'], string> = {
  calendar: 'Calendar',
  finance: 'Finance',
  fitness: 'Fitness',
  'screen-time': 'Screen time',
}

// Disconnecting is hidden for now (a Plaid link can't be reused once removed). Set to true to bring it back.
const SHOW_DISCONNECT = false

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')
export default function ConnectModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Integration[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [linkToken, setLinkToken] = useState<string | null>(null)

  // Lets a long import stop quietly if the dialog is closed meanwhile.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !linkToken && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, linkToken])

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (alive.current) setItems(await integrationsApi.list())
    } catch (err) {
      if (alive.current) setError(errorText(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  /* ---------- Plaid ---------- */

  // Step 1: get a one-time token from our server, which opens Plaid's bank picker.
  const startPlaid = () =>
    run('plaid', async () => {
      const { linkToken } = await plaidApi.linkToken()
      // Banks that sign in on their own site (Citi, Chase...) send the person back to our
      // /plaid-oauth page, which needs this token to pick up where Link left off.
      saveLinkToken(linkToken)
      setLinkToken(linkToken)
    })

  // Step 2: the person finished in Plaid. Our server trades the token and imports the history.
  const finishPlaid = (publicToken: string, institutionName?: string) => {
    setLinkToken(null)
    clearLinkToken()
    return run('plaid', async () => {
      setNotice('Connected. Importing your transactions...')
      const message = await importNewBank(publicToken, institutionName, () => alive.current)
      if (alive.current) setNotice(message)
    })
  }

  const syncPlaid = () =>
    run('plaid', async () => {
      const r = await plaidApi.sync()
      // The other banks still synced, so say which one didn't.
      if (r.errors?.length) setError(r.errors.map((e) => `${e.institution}: ${e.message}`).join(' '))
      setNotice(
        r.added + r.modified + r.removed > 0
          ? `Synced: ${r.added} new, ${r.modified} updated, ${r.removed} removed.`
          : 'Already up to date.',
      )
    })

  const disconnect = (item: Integration) => {
    if (
      item.id === 'plaid' &&
      !window.confirm('Disconnect your banks? Bank transactions imported into Jackal are removed too. Ones you added by hand stay.')
    ) {
      return
    }
    return run(item.id, () => integrationsApi.disconnect(item.id))
  }

  const connectedCount = items?.filter((i) => i.status === 'connected').length ?? 0

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {linkToken && (
        <PlaidLauncher
          key={linkToken}
          token={linkToken}
          onSuccess={finishPlaid}
          onExit={(msg, status) => {
            setBusyId(null)
            if (status === 'requires_oauth') {
              // Link is sending the person to their bank's own site. Keep Link and the saved token alive
              // so the return page can pick up where this left off.
              setNotice("Your bank wants you to sign in on its own site. If nothing opened, allow pop-ups for this address and try Add a bank again.")
              return
            }
            setLinkToken(null)
            clearLinkToken()
            if (msg) setError(msg)
          }}
        />
      )}
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
        {notice && !error && (
          <div className="banner info" role="status" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>{notice}</span>
          </div>
        )}

        {!items && !error && <p className="empty">Loading...</p>}

        {items && (
          <ul className="list" style={{ marginTop: 8 }}>
            {items.map((item) => {
              const busy = busyId === item.id
              const connected = item.status === 'connected'
              return (
                <li key={item.id} className="integration-row">
                  <div className="integration-info">
                    <div className="row">
                      <strong>{item.name}</strong>
                      <span className="pill">{CATEGORY_LABELS[item.category]}</span>
                      {connected ? (
                        <span className="pill good-pill">Connected</span>
                      ) : (
                        !item.available && <span className="pill">Coming soon</span>
                      )}
                    </div>
                    <div className="muted">{item.description}</div>
                    {connected && item.accountLabel && <div className="stat-label">Connected: {item.accountLabel}</div>}
                    {item.note && <div className="stat-label">{item.note}</div>}
                  </div>
                  <div className="row" style={{ flexShrink: 0 }}>
                    {item.id === 'plaid' && connected && (
                      <>
                        <button disabled={busy} onClick={syncPlaid}>
                          Sync now
                        </button>
                        <button disabled={busy} onClick={startPlaid}>
                          Add a bank
                        </button>
                      </>
                    )}
                    {connected ? (
                      SHOW_DISCONNECT && (
                        <button disabled={busy} onClick={() => disconnect(item)}>
                          Disconnect
                        </button>
                      )
                    ) : (
                      <button
                        className="primary"
                        disabled={!item.available || busy}
                        title={item.available ? undefined : item.id === 'plaid' ? 'Plaid keys are missing on the server' : 'Not built yet'}
                        onClick={() => (item.id === 'plaid' ? startPlaid() : run(item.id, () => integrationsApi.connect(item.id)))}
                      >
                        {busy ? 'Working...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
