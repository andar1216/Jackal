import { useEffect, useRef, useState } from 'react'
import { crunchApi, integrationsApi, plaidApi } from '../../lib/api'
import type { Integration } from '../../types'
import { crunchBookmarkCode } from './crunchBookmark'
import PlaidLauncher from './PlaidLauncher'
import { clearLinkToken, importNewBank, saveLinkToken } from './plaidImport'

const CATEGORY_LABELS: Record<Integration['category'], string> = {
  calendar: 'Calendar',
  finance: 'Finance',
  fitness: 'Fitness',
  'screen-time': 'Screen time',
}

const CRUNCH_SITE = 'https://members.crunch.com/'

// Disconnecting is hidden for now (a Plaid link can't be reused once removed). Set to true to bring it back.
const SHOW_DISCONNECT = false

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')
type Props = {
  onClose: () => void
  /** Which connectors to list. Everything, if left out. */
  filter?: (item: Integration) => boolean
  title?: string
}

export default function ConnectModal({ onClose, filter, title = 'Connectors' }: Props) {
  const [items, setItems] = useState<Integration[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [crunchForm, setCrunchForm] = useState<{ email: string; password: string } | null>(null)
  // The steps for connecting from the Crunch tab: the bookmark's address, and when they started.
  const [crunchSetup, setCrunchSetup] = useState<{ code: string; since: number } | null>(null)
  const [crunchAuto, setCrunchAuto] = useState<boolean | null>(null)

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

  /* ---------- Crunch ---------- */

  const connectCrunch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!crunchForm) return
    return run('crunch', async () => {
      setNotice('Signing in to Crunch and importing your history...')
      const r = await crunchApi.connect(crunchForm.email.trim(), crunchForm.password)
      setCrunchForm(null)
      setNotice(`Connected. Imported ${r.checkIns} check-ins, ${r.classes} classes and ${r.payments} payments.`)
    })
  }

  const syncCrunch = () =>
    run('crunch', async () => {
      const r = await crunchApi.sync()
      setNotice(`Synced: ${r.checkIns} check-ins, ${r.classes} classes, ${r.payments} payments.`)
    })

  // Opens Crunch's own site in a new tab (it has to happen right in the click, or the browser blocks it) and
  // makes the bookmark that sends data back from there. The password is typed on Crunch's site, never here.
  const startCrunchInBrowser = () => {
    window.open(CRUNCH_SITE, '_blank', 'noopener,noreferrer')
    setCrunchForm(null)
    return run('crunch', async () => {
      const { token } = await crunchApi.importToken()
      setCrunchSetup({ code: crunchBookmarkCode(`${window.location.origin}/api/integrations/crunch/import`, token), since: Date.now() })
    })
  }

  // While the steps are showing, notice when the bookmark has delivered something.
  const waitingSince = crunchSetup?.since
  useEffect(() => {
    if (waitingSince === undefined) return
    const timer = window.setInterval(() => {
      crunchApi
        .data()
        .then(async (d) => {
          if (!alive.current || !d.connected || !d.lastSyncedAt || Date.parse(d.lastSyncedAt) < waitingSince) return
          setCrunchSetup(null)
          setNotice(`Connected. Got ${d.checkIns.length} check-ins, ${d.classes.length} classes and ${d.payments.length} payments from Crunch.`)
          setItems(await integrationsApi.list())
          crunchApi.changed()
        })
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [waitingSince])

  // Whether Jackal can refresh Crunch by itself (it can if it was given a login) decides which buttons show.
  const crunchConnected = items?.some((i) => i.id === 'crunch' && i.status === 'connected') ?? false
  useEffect(() => {
    if (!crunchConnected) return
    let cancelled = false
    crunchApi
      .data()
      .then((d) => !cancelled && setCrunchAuto(d.autoSync !== false))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [crunchConnected])

  const disconnect = (item: Integration) => {
    if (
      item.id === 'plaid' &&
      !window.confirm('Disconnect your banks? Bank transactions imported into Jackal are removed too. Ones you added by hand stay.')
    ) {
      return
    }
    if (item.id === 'crunch' && !window.confirm('Disconnect Crunch? Your saved login and the imported history are removed from Jackal.')) return
    return run(item.id, () => integrationsApi.disconnect(item.id))
  }

  const shown = items ? items.filter((i) => (filter ? filter(i) : true)) : null
  const connectedCount = shown?.filter((i) => i.status === 'connected').length ?? 0

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
            <h2 id="connect-title">{title}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {shown ? `${connectedCount} of ${shown.length} connected.` : 'Bring in data from other services.'} We're
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

        {shown && shown.length === 0 && <p className="empty">Nothing to connect here yet.</p>}

        {shown && (
          <ul className="list" style={{ marginTop: 8 }}>
            {shown.map((item) => {
              const busy = busyId === item.id
              const connected = item.status === 'connected'
              return (
                <li key={item.id} className="integration-row">
                  <div className="integration-info">
                    <div className="row">
                      <strong>{item.name}</strong>
                      <span className="pill">{CATEGORY_LABELS[item.category]}</span>
                      <span
                        className={`pill api-${item.api}`}
                        title={item.api === 'official' ? 'The service offers an API for this.' : 'No official API. This can break without warning.'}
                      >
                        {item.api === 'official' ? 'Official API' : 'Unofficial API'}
                      </span>
                      {connected ? (
                        <span className="pill good-pill">Connected</span>
                      ) : (
                        !item.available && !item.url && <span className="pill">Coming soon</span>
                      )}
                    </div>
                    <div className="muted">{item.description}</div>
                    {connected && item.accountLabel && <div className="stat-label">Connected: {item.accountLabel}</div>}
                    {item.note && <div className="stat-label">{item.note}</div>}
                    {item.id === 'crunch' && crunchSetup && (
                      <div className="crunch-setup">
                        <ol>
                          <li>
                            Sign in on the Crunch tab that just opened (didn't open?{' '}
                            <a href={CRUNCH_SITE} target="_blank" rel="noopener noreferrer">
                              open it here
                            </a>
                            ).
                          </li>
                          <li>
                            Drag{' '}
                            <a
                              className="button-link"
                              // React refuses javascript: addresses in href, so it is set directly. Clicking it here does nothing; it is for dragging.
                              ref={(el) => {
                                el?.setAttribute('href', crunchSetup.code)
                              }}
                              onClick={(e) => e.preventDefault()}
                            >
                              Send to Jackal
                            </a>{' '}
                            to your bookmarks bar.{' '}
                            <button type="button" className="link" onClick={() => void navigator.clipboard?.writeText(crunchSetup.code)}>
                              Can't drag? Copy it
                            </button>{' '}
                            and paste it as the address of a new bookmark.
                          </li>
                          <li>
                            On the Crunch tab, click that bookmark. This window updates by itself when the data arrives.
                          </li>
                        </ol>
                        <p className="stat-label">
                          Your Crunch password stays on Crunch's page. The bookmark carries a secret that can only send Crunch data to Jackal.
                          If your browser asks to allow access to local devices, choose Allow. Click the bookmark again whenever you want fresh data.
                        </p>
                        <div className="row">
                          <button type="button" className="link" onClick={() => setCrunchSetup(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setCrunchSetup(null)
                              setCrunchForm({ email: '', password: '' })
                            }}
                          >
                            Or let Jackal sign in for me, so it can refresh by itself
                          </button>
                        </div>
                      </div>
                    )}
                    {item.id === 'crunch' && crunchForm && !connected && (
                      <form className="form" onSubmit={connectCrunch} style={{ marginTop: 8 }}>
                        <input
                          type="email"
                          placeholder="Crunch email"
                          autoComplete="username"
                          required
                          autoFocus
                          value={crunchForm.email}
                          onChange={(e) => setCrunchForm({ ...crunchForm, email: e.target.value })}
                        />
                        <input
                          type="password"
                          placeholder="Crunch password"
                          autoComplete="current-password"
                          required
                          value={crunchForm.password}
                          onChange={(e) => setCrunchForm({ ...crunchForm, password: e.target.value })}
                        />
                        <button className="primary" type="submit" disabled={busy}>
                          {busy ? 'Working...' : 'Sign in and import'}
                        </button>
                        <button type="button" className="link" disabled={busy} onClick={() => setCrunchForm(null)}>
                          Cancel
                        </button>
                      </form>
                    )}
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
                    {item.url && (
                      <a className="button-link" href={item.url} target="_blank" rel="noopener noreferrer">
                        Open site ↗
                      </a>
                    )}
                    {item.id === 'crunch' && connected && (
                      <>
                        {crunchAuto === false ? (
                          <button
                            disabled={busy}
                            title="Makes a new bookmark. The old one stops working."
                            onClick={startCrunchInBrowser}
                          >
                            New bookmark
                          </button>
                        ) : (
                          <button disabled={busy || crunchAuto === null} onClick={syncCrunch}>
                            Sync now
                          </button>
                        )}
                        <button disabled={busy} onClick={() => disconnect(item)}>
                          Disconnect
                        </button>
                      </>
                    )}
                    {connected ? (
                      SHOW_DISCONNECT && item.id !== 'crunch' && (
                        <button disabled={busy} onClick={() => disconnect(item)}>
                          Disconnect
                        </button>
                      )
                    ) : (
                      <button
                        className="primary"
                        disabled={!item.available || busy}
                        title={
                          item.available
                            ? undefined
                            : item.id === 'plaid'
                              ? 'Plaid keys are missing on the server'
                              : 'Not built yet'
                        }
                        onClick={() => {
                          if (item.id === 'plaid') startPlaid()
                          else if (item.id === 'crunch') void startCrunchInBrowser()
                          else run(item.id, () => integrationsApi.connect(item.id))
                        }}
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
