import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, authApi, setUnauthorizedHandler } from '../lib/api'
import type { User } from '../types'
import { AuthContext, type AuthState } from './context'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [attempt, setAttempt] = useState(0)

  // Check for an existing session on load. If the server is unreachable, keep trying quietly.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    authApi
      .me()
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('signed-in')
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          setStatus('signed-out')
        } else {
          setStatus('error')
          timer = window.setTimeout(() => setAttempt((n) => n + 1), 3000)
        }
      })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [attempt])

  // If any request later finds the session gone, go back to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      setStatus('signed-out')
    })
  }, [])

  const enter = useCallback((next: User) => {
    setUser(next)
    setStatus('signed-in')
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      signIn: async (email, password) => enter(await authApi.login({ email, password })),
      register: async (email, name, password) => enter(await authApi.register({ email, name, password })),
      signOut: async () => {
        try {
          await authApi.logout()
        } catch {
          // Even if the server can't be reached, leave the signed-in view.
        }
        setUser(null)
        setStatus('signed-out')
      },
      updateName: async (name) => setUser(await authApi.updateName(name)),
      retry: () => setAttempt((n) => n + 1),
    }),
    [status, user, enter],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
