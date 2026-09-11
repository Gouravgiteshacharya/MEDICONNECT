import assert from 'node:assert/strict'
import test from 'node:test'
import { UnavailableSupportClient } from '../src/modules/support/support.client.js'

test('unavailable support client never fabricates successful reads or writes', async () => {
  const client = new UnavailableSupportClient()
  const results = await Promise.all([
    client.createTicket({ subject: 'Request', description: 'Details', category: 'OTHER' }),
    client.listOwnTickets(),
    client.getOwnTicket('ticket-id'),
    client.addMessage('ticket-id', 'message'),
  ])

  for (const result of results) {
    assert.equal(result.status, 'error')
    assert.equal(result.code, 'unavailable')
    assert.equal('data' in result, false)
  }
})
