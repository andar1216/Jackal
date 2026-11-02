import { Router } from 'express'
import { currentUserId } from '../auth/middleware.js'
import { HttpError } from '../lib/errors.js'
import { Connection } from '../models.js'
import { crunchRouter, disconnectCrunch } from './crunch.js'
import { disconnectPlaid, plaidRouter, plaidStatus } from './plaid.js'
import { ACTIVITYWATCH_PROVIDER, activityWatchRouter, disconnectActivityWatch } from './activityWatch.js'
import { PHONE_PROVIDER, disconnectPhones, phoneRouter } from './phone.js'
import { screenTimeRouter } from './screenTime.js'
import { findProvider, providers } from './registry.js'

export const integrations = Router()

const requireProvider = (id: string) => {
  const provider = findProvider(id)
  if (!provider) throw new HttpError(404, 'Unknown integration')
  return provider
}

// Provider-specific steps (Plaid Link and so on) live under their own path.
integrations.use('/plaid', plaidRouter)
integrations.use('/crunch', crunchRouter)
integrations.use('/screen-time', screenTimeRouter)
integrations.use('/activitywatch', activityWatchRouter)
integrations.use('/phone', phoneRouter)

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
        api: p.api,
        url: p.url,
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
  if (provider.id === 'crunch') throw new HttpError(400, 'Crunch connects with your member email and password. See /integrations/crunch/connect.')
  if (provider.id === ACTIVITYWATCH_PROVIDER) throw new HttpError(400, 'ActivityWatch is connected on the Screen Time page.')
  if (provider.id === PHONE_PROVIDER) throw new HttpError(400, 'Phones are paired on the Screen Time page.')
  throw new HttpError(501, `${provider.name} isn't available yet.`)
})

integrations.delete('/:id/connection', async (req, res) => {
  const provider = requireProvider(req.params.id)
  const userId = currentUserId(req)
  if (provider.id === 'plaid') await disconnectPlaid(userId)
  else if (provider.id === 'crunch') await disconnectCrunch(userId)
  else if (provider.id === ACTIVITYWATCH_PROVIDER) await disconnectActivityWatch(userId)
  else if (provider.id === PHONE_PROVIDER) await disconnectPhones(userId)
  else await Connection.deleteOne({ provider: provider.id, userId })
  res.status(204).end()
})
