import { apiRequest } from '../../services/apiClient'

export async function createPickupOrder() {
  return apiRequest('/orders', {
    method: 'POST',
    body: {
      fulfillmentMethod: 'SELF_PICKUP',
    },
  })
}

export async function getOrders(options = {}) {
  const {
    limit = 20,
    cursor,
    status,
  } = options

  const params = new URLSearchParams({
    limit: String(limit),
  })

  if (cursor) params.set('cursor', cursor)
  if (status) params.set('status', status)

  return apiRequest(`/orders?${params.toString()}`)
}

export async function getOrder(orderId) {
  return apiRequest(`/orders/${orderId}`)
}
