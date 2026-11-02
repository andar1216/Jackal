import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'
import { requireSameOrigin } from './auth/middleware.js'
import { config } from './config.js'
import { crunchImportRouter } from './integrations/crunch.js'
import { phoneAppRouter } from './integrations/phone.js'
import { errorHandler, notFound } from './lib/errors.js'
import { api } from './routes.js'

const CRUNCH_ORIGIN = 'https://members.crunch.com'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')

  // The "Send to Valkyrie" bookmark posts from members.crunch.com, so this one route answers that one website and
  // nothing else. It sits ahead of the rules below (own-site only, sign-in cookie), and proves itself with the
  // bookmark's secret instead. Newer Chrome asks before a public site talks to a local one, hence the extra header.
  app.use(
    '/api/integrations/crunch/import',
    (req, res, next) => {
      if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true')
      next()
    },
    cors({ origin: CRUNCH_ORIGIN, methods: ['POST'], allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }),
    express.json({ limit: '3mb' }),
    crunchImportRouter,
  )

  // The phone app (see the android folder) is not a browser: no cookie, no Origin. It proves itself with its own key.
  // A Strong export can be a few megabytes: years of sets, one row each.
  app.use('/api/phone/app/workouts/import-strong', express.json({ limit: '6mb' }))
  app.use('/api/phone', express.json({ limit: '1mb' }), phoneAppRouter)

  // `credentials: true` lets the browser send the session cookie. Only our own frontend is allowed.
  app.use(cors({ origin: config.clientOrigin, credentials: true }))
  app.use('/api/workouts/import/strong', express.json({ limit: '6mb' }))
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    // readyState 1 = connected
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 })
  })

  app.use('/api', requireSameOrigin, api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
