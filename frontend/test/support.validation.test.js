import assert from 'node:assert/strict'
import test from 'node:test'
import { SUPPORT_CATEGORIES } from '../src/modules/support/support.constants.js'
import { isUuid, validateSupportMessage, validateTicketForm } from '../src/modules/support/support.validation.js'

const valid = { subject: 'Late delivery', description: 'My order has not arrived.', category: 'DELAYED_DELIVERY', orderId: '' }

test('support categories exactly match the backend contract', () => {
  assert.deepEqual(SUPPORT_CATEGORIES.map(({ value }) => value), ['DELAYED_DELIVERY', 'WRONG_ORDER', 'MISSING_ITEM', 'PAYMENT', 'RIDER', 'PHARMACY', 'PRESCRIPTION', 'OTHER'])
})

test('ticket validation trims valid customer input', () => {
  const result = validateTicketForm({ ...valid, subject: '  Late delivery  ', description: '  Please help.  ' })
  assert.equal(result.valid, true)
  assert.equal(result.values.subject, 'Late delivery')
  assert.equal(result.values.description, 'Please help.')
})

test('subject length is validated', () => {
  assert.equal(validateTicketForm({ ...valid, subject: 'ab' }).valid, false)
  assert.equal(validateTicketForm({ ...valid, subject: 'x'.repeat(121) }).valid, false)
})

test('description length is validated', () => {
  assert.equal(validateTicketForm({ ...valid, description: ' ' }).valid, false)
  assert.equal(validateTicketForm({ ...valid, description: 'x'.repeat(2001) }).valid, false)
})

test('category must be supported', () => {
  assert.equal(validateTicketForm({ ...valid, category: 'UNKNOWN' }).valid, false)
})

test('optional order ID must be a UUID when present', () => {
  assert.equal(isUuid('33333333-3333-4333-8333-333333333333'), true)
  assert.equal(validateTicketForm({ ...valid, orderId: 'not-an-id' }).valid, false)
})

test('message validation enforces trimmed 1 to 2000 character content', () => {
  assert.deepEqual(validateSupportMessage('  Update please  '), { valid: true, value: 'Update please' })
  assert.equal(validateSupportMessage(' ').valid, false)
  assert.equal(validateSupportMessage('x'.repeat(2001)).valid, false)
})
