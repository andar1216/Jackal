import { createHash, randomBytes } from 'node:crypto'
import type { CookieOptions } from 'express'
import type { Types } from 'mongoose'
import { config } from '../config.js'
import { Session } from '../models.js'

export const COOKIE_NAME = 'jackal_sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Only a hash of the token is stored, so a database leak doesn't hand out working sessions.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const cookieOptions = (): CookieOptions => ({
  httpOnly: true, // not readable from page JavaScript
  sameSite: 'lax',
  secure: config.isProduction, // HTTPS only in production
  path: '/',
  maxAge: SESSION_TTL_MS,
})

export async function createSession(userId: Types.ObjectId) {
  const token = randomBytes(32).toString('base64url')
  await Session.create({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
  return token
}

export const findSession = (token: string) =>
  Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })

export const deleteSession = (token: string) => Session.deleteOne({ tokenHash: hashToken(token) })

export function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      // Ignore cookies that aren't valid URL-encoding.
    }
  }
  return cookies
}
