import { apiRequest } from '../../services/apiClient'

export async function listOrderPrescriptions(orderId) {
  return apiRequest(`/orders/${orderId}/prescriptions`)
}

export async function createOrderPrescription(orderId, body) {
  return apiRequest(`/orders/${orderId}/prescriptions`, {
    method: 'POST',
    body,
  })
}
