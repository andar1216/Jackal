import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { balanceCents } from '../src/lib/balances.js'

describe('account balances', () => {
  it('uses what the bank reports, in whole cents', () => {
    assert.equal(balanceCents({ type: 'depository', current: 1200.5, available: 1200.5 }), 120050)
    assert.equal(balanceCents({ type: 'credit', current: 3851.99, available: 35.71, limit: 4000 }), 385199, 'does not second-guess a card that reports a balance')
  })

  it('works out what is owed from available credit when a card reports 0', () => {
    // U.S. Bank: current is 0 but 1,319.60 of the 3,000 limit is in use.
    assert.equal(balanceCents({ type: 'credit', current: 0, available: 1680.4, limit: 3000 }), 131960)
    assert.equal(balanceCents({ type: 'credit', current: null, available: 1680.4, limit: 3000 }), 131960)
  })

  it('keeps 0 when a card really is unused, and never invents a balance for bank accounts', () => {
    assert.equal(balanceCents({ type: 'credit', current: 0, available: 3000, limit: 3000 }), 0)
    assert.equal(balanceCents({ type: 'credit', current: 0 }), 0)
    assert.equal(balanceCents({ type: 'depository', current: 0, available: 0, limit: 500 }), 0)
    assert.equal(balanceCents({ type: 'credit' }), undefined)
  })

  it('keeps a credit balance on a card (overpaid)', () => {
    assert.equal(balanceCents({ type: 'credit', current: -25, available: 3025, limit: 3000 }), -2500)
  })
})
