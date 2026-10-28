import { createContext, useContext } from 'react'
import type { User } from '../types'

export type AuthState = {
  /** `loading`: checking for an existing session. `error`: the server can't be reached. */
  status: 'loading' | 'signed-out' | 'signed-in' | 'error'
  user: User | null
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, name: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  updateName: (name: string) => Promise<void>
  retry: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
