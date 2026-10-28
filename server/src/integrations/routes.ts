import { Router } from 'express'
import { HttpError } from '../lib/errors.js'
import { Connection } from '../models.js'
import { findProvider, providers } from './registry.js'

export const integrations = Router()

const requireProvider = (id: string) => {
  const provider = findProvider(id)
  if (!provider) throw new HttpError(404, 'Unknown integration')
  return provider
}

// List every integration with its connection state.
integrations.get('/', async (_req, res) => {
  const connections = await Connection.find()
  const byProvider = new Map(connections.map((c) => [c.provider, c]))

  res.json(
    providers.map((p) => {
      const connection = byProvider.get(p.id)
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        note: p.note,
        available: p.implemented,
        status: connection ? 'connected' : 'not_connected',
        connectedAt: connection?.connectedAt,
        accountLabel: connection?.accountLabel,
      }
    }),
  )
})

// Start connecting. Each provider's real flow (OAuth redirect, Plaid Link, ...) gets added here
// as we build them one at a time.
integrations.post('/:id/connect', (req) => {
  const provider = requireProvider(req.params.id)
  throw new HttpError(501, `${provider.name} isn't available yet.`)
})

integrations.delete('/:id/connection', async (req, res) => {
  const provider = requireProvider(req.params.id)
  await Connection.deleteOne({ provider: provider.id })
  res.status(204).end()
})
