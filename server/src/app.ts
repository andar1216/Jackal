import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'
import { config } from './config.js'
import { errorHandler, notFound } from './lib/errors.js'
import { api } from './routes.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(cors({ origin: config.clientOrigin }))
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', (_req, res) => {
    // readyState 1 = connected
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 })
  })

  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
