import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantRequest, createAssistantClient, UnavailableAssistantClient } from '../src/modules/assistant/assistant.client.js'

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

test('authenticated assistant client delegates through the session request boundary', async () => {
  const calls = []
  const response = {
    status: 'fulfilled',
    intent: 'medicine_discovery',
    message: 'Medicine availability found.',
    suggestedActions: [],
  }
  const session = {
    async request(path, options) {
      calls.push({ path, options })
      return response
    },
  }
  const request = buildAssistantRequest('  Find Crocin near me  ', 'opaque-correlation')
  const result = await createAssistantClient(session).respond(request)

  assert.deepEqual(calls, [{
    path: '/assistant/respond',
    options: {
      method: 'POST',
      body: request,
    },
  }])
  assert.strictEqual(result, response)
  assert.equal('token' in calls[0].options, false)
  assert.equal('userId' in calls[0].options.body, false)
  assert.equal('roles' in calls[0].options.body, false)
})