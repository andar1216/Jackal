import { useState, type FormEvent } from 'react'
import { useAuth } from './context'

type Mode = 'sign-in' | 'sign-up'

export default function AuthPage() {
  const { signIn, register } = useAuth()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSignUp = mode === 'sign-up'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isSignUp) await register(email, name, password)
      else await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  const switchMode = () => {
    setMode(isSignUp ? 'sign-in' : 'sign-up')
    setError(null)
  }

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">Jackal</div>
        <h2>{isSignUp ? 'Create your account' : 'Welcome back'}</h2>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {isSignUp && (
          <label className="field">
            <span className="stat-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
          </label>
        )}
        <label className="field">
          <span className="stat-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span className="stat-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={isSignUp ? 10 : undefined}
            maxLength={200}
            required
          />
          {isSignUp && <span className="muted">At least 10 characters. A few random words works well.</span>}
        </label>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
        <button className="link" type="button" onClick={switchMode}>
          {isSignUp ? 'I already have an account' : 'Create an account'}
        </button>
      </form>
    </div>
  )
}
