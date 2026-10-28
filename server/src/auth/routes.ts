import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { HttpError } from '../lib/errors.js'
import { User, adoptOrphanedData } from '../models.js'
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js'
import { createAttemptLimiter, currentUserId, requireAuth, type AuthUser } from './middleware.js'
import { COOKIE_NAME, cookieOptions, createSession, deleteSession, parseCookies } from './session.js'

export const auth = Router()

const email = z.string().trim().toLowerCase().pipe(z.email().max(254))
const name = z.string().trim().min(1).max(80)

const registerSchema = z.strictObject({
  email,
  name,
  // Length matters more than character rules. The upper bound stops absurdly long inputs.
  password: z.string().min(10, 'Use at least 10 characters').max(200),
})

const loginSchema = z.strictObject({ email, password: z.string().min(1).max(200) })

const profileSchema = z.strictObject({ name })

const publicUser = (user: { _id: unknown; email: string; name: string }): AuthUser => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
})

// 10 failed sign-ins per email and address within 15 minutes, then wait.
const loginLimiter = createAttemptLimiter(10, 15 * 60 * 1000)

auth.post('/register', async (req, res) => {
  const { email, name, password } = registerSchema.parse(req.body)

  const isFirstAccount = (await User.estimatedDocumentCount()) === 0
  if (!config.allowRegistration && !isFirstAccount) {
    throw new HttpError(403, 'New sign-ups are turned off.')
  }

  let user
  try {
    user = await User.create({ email, name, passwordHash: await hashPassword(password) })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, 'An account with this email already exists.')
    }
    throw err
  }

  // Anything saved before accounts existed now belongs to the first account.
  if (isFirstAccount) await adoptOrphanedData(user._id)

  res.cookie(COOKIE_NAME, await createSession(user._id), cookieOptions())
  res.status(201).json(publicUser(user))
})

auth.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)

  const key = `${req.ip}|${email}`
  if (loginLimiter.isBlocked(key)) {
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.')
  }

  const user = await User.findOne({ email })
  const valid = user ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false)
  if (!user || !valid) {
    loginLimiter.recordFailure(key)
    // The same message for "no such email" and "wrong password".
    throw new HttpError(401, 'Invalid email or password.')
  }

  loginLimiter.reset(key)
  res.cookie(COOKIE_NAME, await createSession(user._id), cookieOptions())
  res.json(publicUser(user))
})

auth.post('/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (token) await deleteSession(token)
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined })
  res.status(204).end()
})

auth.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})

auth.patch('/me', requireAuth, async (req, res) => {
  const { name } = profileSchema.parse(req.body)
  const user = await User.findByIdAndUpdate(currentUserId(req), { name }, { returnDocument: 'after' })
  if (!user) throw new HttpError(401, 'Sign in required')
  res.json(publicUser(user))
})
