import assert from 'node:assert/strict'
import test from 'node:test'
import { getActionDisplayMode, getResponsePresentation, getToolErrorLabel, getToolResultPresentation } from '../src/modules/assistant/assistant.format.js'

test('response statuses have distinct customer-facing labels', () => {
  assert.equal(getResponsePresentation('fulfilled').label, 'Completed')
  assert.equal(getResponsePresentation('refused').label, 'Medical safety')
  assert.equal(getResponsePresentation('unsupported').label, 'How I can help')
  assert.equal(getResponsePresentation('error').label, 'Unable to complete')
})

test('known tool errors have customer-facing labels with an unknown fallback', () => {
  assert.equal(getToolErrorLabel('invalid_request'), 'More information needed')
  assert.equal(getToolErrorLabel('not_found'), 'Not found')
  assert.equal(getToolErrorLabel('forbidden'), 'Access unavailable')
  assert.equal(getToolErrorLabel('unavailable'), 'Service unavailable')
  assert.equal(getToolErrorLabel('execution_failed'), 'Request failed')
  assert.equal(getToolErrorLabel('unexpected'), 'Request error')
})

test('targetless navigation and professional contact actions are informational', () => {
  assert.equal(getActionDisplayMode({ kind: 'navigate' }), 'informational')
  assert.equal(getActionDisplayMode({ kind: 'contact_professional' }), 'informational')
})

test('unknown successful tool data is not serialized or interpreted', () => {
  const secretValue = { arbitrary: { nested: 'do not render' } }
  const presentation = getToolResultPresentation({ status: 'success', data: secretValue })
  assert.equal(presentation, null)
})
