export const SUPPORT_CATEGORIES = Object.freeze([
  { value: 'DELAYED_DELIVERY', label: 'Delayed delivery' },
  { value: 'WRONG_ORDER', label: 'Wrong order' },
  { value: 'MISSING_ITEM', label: 'Missing item' },
  { value: 'PAYMENT', label: 'Payment issue' },
  { value: 'RIDER', label: 'Delivery partner issue' },
  { value: 'PHARMACY', label: 'Pharmacy issue' },
  { value: 'PRESCRIPTION', label: 'Prescription workflow' },
  { value: 'OTHER', label: 'Other' },
])

export const SUPPORT_CATEGORY_LABELS = Object.freeze(
  Object.fromEntries(SUPPORT_CATEGORIES.map(({ value, label }) => [value, label])),
)

export const SUPPORT_STATUS_LABELS = Object.freeze({
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
})

export const SUPPORT_ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Please review the information and try again.',
  not_found: 'This support ticket could not be found.',
  forbidden: 'You do not have permission to access this support ticket.',
  unavailable: 'Support services are not connected yet. Please try again later.',
  execution_failed: 'Something went wrong while contacting support. Please try again.',
})
