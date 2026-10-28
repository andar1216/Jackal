import { Router } from 'express'
import { isValidObjectId, type Model } from 'mongoose'
import type { z } from 'zod'
import { currentUserId } from '../auth/middleware.js'
import { dateString } from '../validation.js'
import { HttpError } from './errors.js'

type Options = {
  /** Zod schema for creating a document. PATCH uses its `.partial()`. */
  schema: z.ZodObject
  /** Query-string params that filter by exact match, e.g. `?category=Food`. */
  filters?: string[]
  /** Field that `?from=` and `?to=` (inclusive) filter on. */
  range?: { field: string; kind: 'day' | 'timestamp' }
  sort?: Record<string, 1 | -1>
}

export const requireId = (id: string) => {
  if (!isValidObjectId(id)) throw new HttpError(400, 'Invalid id')
  return id
}

/**
 * Standard list / get / create / update / delete routes for a model.
 * Every query is limited to the signed-in user's own documents, so one user can never
 * read or change another's (a document that belongs to someone else is simply "not found").
 */
export function crudRouter(model: Model<any>, { schema, filters = [], range, sort = { createdAt: 1 } }: Options) {
  const router = Router()
  const updateSchema = schema.partial()
  // `_id` breaks ties so documents created in the same millisecond keep a stable order.
  const order = { ...sort, _id: 1 as const }

  const parseBound = (value: string): string | Date => {
    if (range?.kind === 'day') return dateString.parse(value)
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `Invalid date: ${value}`)
    return parsed
  }

  router.get('/', async (req, res) => {
    const query: Record<string, unknown> = { userId: currentUserId(req) }
    // Only plain strings are accepted, which also blocks operator injection like ?x[$ne]=1.
    for (const key of filters) {
      const value = req.query[key]
      if (typeof value === 'string') query[key] = value
    }
    if (range) {
      const { from, to } = req.query
      const bounds: Record<string, string | Date> = {}
      if (typeof from === 'string') bounds.$gte = parseBound(from)
      if (typeof to === 'string') bounds.$lte = parseBound(to)
      if (Object.keys(bounds).length > 0) query[range.field] = bounds
    }
    res.json(await model.find(query).sort(order))
  })

  router.get('/:id', async (req, res) => {
    const doc = await model.findOne({ _id: requireId(req.params.id), userId: currentUserId(req) })
    if (!doc) throw new HttpError(404, 'Not found')
    res.json(doc)
  })

  router.post('/', async (req, res) => {
    const doc = await model.create({ ...schema.parse(req.body), userId: currentUserId(req) })
    res.status(201).json(doc)
  })

  router.patch('/:id', async (req, res) => {
    const doc = await model.findOneAndUpdate(
      { _id: requireId(req.params.id), userId: currentUserId(req) },
      updateSchema.parse(req.body),
      { returnDocument: 'after', runValidators: true },
    )
    if (!doc) throw new HttpError(404, 'Not found')
    res.json(doc)
  })

  router.delete('/:id', async (req, res) => {
    const doc = await model.findOneAndDelete({ _id: requireId(req.params.id), userId: currentUserId(req) })
    if (!doc) throw new HttpError(404, 'Not found')
    res.status(204).end()
  })

  return router
}
