import { Router } from 'express'
import { currentUserId } from '../auth/middleware.js'
import { HttpError } from '../lib/errors.js'
import { Connection } from '../models.js'
import { disconnectPlaid, plaidRouter, plaidStatus } from './plaid.js'
import { findProvider, providers } from './registry.js'

export const integrations = Router()

const requireProvider = (id: string) => {
  const provider = findProvider(id)
  if (!provider) throw new HttpError(404, 'Unknown integration')
  return provider
}

// Provider-specific steps (Plaid Link and so on) live under their own path.
integrations.use('/plaid', plaidRouter)

// List every integration with this user's connection state.
integrations.get('/', async (req, res) => {
  const userId = currentUserId(req)
  const connections = await Connection.find({ userId })
  const byProvider = new Map(connections.map((c) => [c.provider, c]))
  const plaid = await plaidStatus(userId)

  res.json(
    providers.map((p) => {
      // Plaid keeps its own records (one per bank), so its state comes from there.
      const connection = p.id === 'plaid' ? plaid : byProvider.get(p.id)
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        note: p.note,
        available: p.implemented && (p.isConfigured?.() ?? true),
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
  if (provider.id === 'plaid') throw new HttpError(400, 'Plaid connects through Plaid Link. See /integrations/plaid/link-token.')
  throw new HttpError(501, `${provider.name} isn't available yet.`)
})

integrations.delete('/:id/connection', async (req, res) => {
  const provider = requireProvider(req.params.id)
  const userId = currentUserId(req)
  if (provider.id === 'plaid') await disconnectPlaid(userId)
  else await Connection.deleteOne({ provider: provider.id, userId })
  res.status(204).end()
})
