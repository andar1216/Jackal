import { Connection } from '../models.js'
import { plaidStatus } from './plaid.js'
import { providers } from './registry.js'

/** Every integration with this person's connection state. Shared by the website's Connectors and the phone app. */
export async function integrationList(userId: unknown) {
  const connections = await Connection.find({ userId })
  const byProvider = new Map(connections.map((c) => [c.provider, c]))
  const plaid = await plaidStatus(userId as string)

  return providers.map((p) => {
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
  })
}