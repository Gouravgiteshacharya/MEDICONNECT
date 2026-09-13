import { apiRequest } from '../../services/apiClient'

export function labelFromEnum(value) {
  if (!value) return 'Not available'

  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function dispatchOrder(orderId) {
  return apiRequest(`/dispatch/orders/${orderId}`, {
    method: 'POST',
    body: {},
  })
}

export async function evaluateDeliveryBatch(body) {
  return apiRequest('/delivery-batches/evaluate', {
    method: 'POST',
    body,
  })
}

export async function optimizeDeliveryBatch(batchId) {
  return apiRequest(`/delivery-batches/${batchId}/optimize`, {
    method: 'POST',
    body: {},
  })
}
