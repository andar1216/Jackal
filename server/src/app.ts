import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'
import { requireSameOrigin } from './auth/middleware.js'
import { config } from './config.js'
import { errorHandler, notFound } from './lib/errors.js'
import { api } from './routes.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  // `credentials: true` lets the browser send the session cookie. Only our own frontend is allowed.
  app.use(cors({ origin: config.clientOrigin, credentials: true }))
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
