import { SUPPORT_CATEGORIES } from './support.constants.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATEGORY_VALUES = new Set(SUPPORT_CATEGORIES.map(({ value }) => value))

export function validateTicketForm(input) {
  const values = {
    subject: normalize(input.subject),
    description: normalize(input.description),
    category: normalize(input.category),
    orderId: normalize(input.orderId),
  }
  const errors = {}

  if (values.subject.length < 3 || values.subject.length > 120) {
    errors.subject = 'Subject must be between 3 and 120 characters.'
  }
  if (values.description.length < 1 || values.description.length > 2000) {
    errors.description = 'Description must be between 1 and 2,000 characters.'
  }
  if (!CATEGORY_VALUES.has(values.category)) {
    errors.category = 'Choose a support category.'
  }
  if (values.orderId && !isUuid(values.orderId)) {
    errors.orderId = 'Enter a valid order ID.'
  }

  return { valid: Object.keys(errors).length === 0, values, errors }
}

export function validateSupportMessage(message) {
  const value = normalize(message)
  return value.length >= 1 && value.length <= 2000
    ? { valid: true, value }
    : { valid: false, value, error: 'Message must be between 1 and 2,000 characters.' }
}

export function isUuid(value) {
  return UUID_PATTERN.test(value)
}

function normalize(value) {
  return typeof value === 'string' ? value.trim() : ''
}
