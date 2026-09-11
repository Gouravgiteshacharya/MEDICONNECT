import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantRequest, UnavailableAssistantClient } from '../src/modules/assistant/assistant.client.js'

test('unavailable assistant client returns an explicit unavailable error and no fake success', async () => {
  const result = await new UnavailableAssistantClient().respond({ message: 'Find Crocin near me', channel: 'text' })
  assert.equal(result.status, 'error')
  assert.equal(result.intent, 'unknown')
  assert.equal(result.toolResult.status, 'error')
  assert.equal(result.toolResult.code, 'unavailable')
  assert.equal('data' in result.toolResult, false)
})

test('assistant request trims text and includes only the deterministic request contract', () => {
  const request = buildAssistantRequest('  Find Crocin near me  ', 'opaque-correlation')
  assert.deepEqual(request, { message: 'Find Crocin near me', channel: 'text', correlationId: 'opaque-correlation' })
  assert.equal('userId' in request, false)
  assert.equal('roles' in request, false)
  assert.equal('history' in request, false)
})

test('assistant request does not require identity or correlation data', () => {
  assert.deepEqual(buildAssistantRequest('Find a pharmacy nearby'), { message: 'Find a pharmacy nearby', channel: 'text' })
})
