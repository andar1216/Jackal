import type { ErrorRequestHandler, RequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' })
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ error: err.message })
    return
  }
  // Body-parser errors (malformed JSON, payload too large) carry a 4xx status.
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
