import type { Request, RequestHandler } from 'express'
import { config } from '../config.js'
import { HttpError } from '../lib/errors.js'
import { User } from '../models.js'
import { COOKIE_NAME, SESSION_TTL_MS, cookieOptions, findSession, parseCookies } from './session.js'

export type AuthUser = { id: string; email: string; name: string }

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

/** The signed-in user's id. Only call this on routes behind `requireAuth`. */
export function currentUserId(req: Request) {
  if (!req.user) throw new HttpError(401, 'Sign in required')
  return req.user.id
}

/** Rejects the request unless it carries a valid session cookie, and sets `req.user`. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  const session = token ? await findSession(token) : null
  const user = session ? await User.findById(session.userId) : null
  if (!token || !session || !user) throw new HttpError(401, 'Sign in required')

  // Sliding expiry: stay signed in as long as you keep using the app.
  if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await session.save()
    res.cookie(COOKIE_NAME, token, cookieOptions())
  }

  req.user = { id: String(user._id), email: user.email, name: user.name }
  next()
}

/**
 * Extra protection against cross-site requests: anything that changes data must come from
 * our own frontend. Requests without an Origin header (curl, tests) are not browsers, so they pass.
 */
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
  const origin = req.headers.origin
  if (!safe && origin && origin !== config.clientOrigin) {
    throw new HttpError(403, `Requests from ${origin} aren't allowed.`)
  }
  next()
}

/** A small in-memory limit on repeated failures, keyed by IP address and email. */
export function createAttemptLimiter(maxAttempts: number, windowMs: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>()
  const current = (key: string) => {
    const entry = attempts.get(key)
    if (entry && entry.resetAt > Date.now()) return entry
    attempts.delete(key)
    return undefined
  }
  return {
    isBlocked: (key: string) => (current(key)?.count ?? 0) >= maxAttempts,
    recordFailure(key: string) {
      const entry = current(key) ?? { count: 0, resetAt: Date.now() + windowMs }
      entry.count++
      attempts.set(key, entry)
    },
    reset: (key: string) => void attempts.delete(key),
  }
}
