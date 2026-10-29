import { useEffect, useRef, useState } from 'react'
import { TRANSACTIONS_CHANGED } from '../../lib/api'
import PlaidLauncher from './PlaidLauncher'
import { clearLinkToken, importNewBank, loadLinkToken } from './plaidImport'

/**
 * The page a bank like Citi sends you back to after you approve Jackal on the bank's own site.
 * It reopens Plaid Link where it left off, then imports the new bank and returns to the app.
 */
export default function PlaidOAuthReturn() {
  // Read once. The token is cleared when we finish, and this must not flip to "missing" meanwhile.
  const [token] = useState(loadLinkToken)
  const [launch, setLaunch] = useState(token !== null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const goHome = () => window.location.replace('/')

  const finish = async (publicToken: string, institutionName?: string) => {
    setLaunch(false)
    clearLinkToken()
    setMessage('Connected. Importing your transactions...')
    try {
      const done = await importNewBank(publicToken, institutionName, () => alive.current)
      window.dispatchEvent(new Event(TRANSACTIONS_CHANGED))
      if (alive.current) setMessage(done)
    } catch (err) {
      if (alive.current) {
        setMessage(null)
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    }
  }

  return (
    <div className="auth-status">
      <div className="brand">Jackal</div>
      {launch && token && (
        <PlaidLauncher
          token={token}
          receivedRedirectUri={window.location.href}
          onSuccess={finish}
          onExit={(msg, status) => {
            setLaunch(false)
            clearLinkToken()
            setError(
              msg ??
                (status === 'requires_oauth'
                  ? "Your bank didn't send you back with an approval. Open Connect and add the bank again."
                  : 'Linking was cancelled.'),
            )
          }}
        />
      )}
      {!token && !message && !error && (
        <p className="muted">That sign-in link has expired. Open Connect and add the bank again.</p>
      )}
      {launch && !message && <p className="muted">Finishing with your bank...</p>}
      {message && <p className="muted">{message}</p>}
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!launch && (
        <div>
          <button className="primary" onClick={goHome}>
            Back to Jackal
          </button>
        </div>
      )}
    </div>
  )
}
