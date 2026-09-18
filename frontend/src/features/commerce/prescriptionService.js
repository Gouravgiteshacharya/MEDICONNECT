import { apiRequest } from '../../services/apiClient'

export async function listOrderPrescriptions(orderId) {
  return apiRequest(`/orders/${orderId}/prescriptions`)
}

export async function createOrderPrescription(orderId, body) {
  const formData = new FormData()
  formData.append('file', body.file)
  if (body.supersedesPrescriptionId) {
    formData.append('supersedesPrescriptionId', body.supersedesPrescriptionId)
  }

  return apiRequest(`/orders/${orderId}/prescriptions`, {
    method: 'POST',
    headers: { 'Idempotency-Key': body.idempotencyKey },
    body: formData,
  })
}

export async function listPrescriptionLibrary(options = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 20) })
  if (options.cursor) params.set('cursor', options.cursor)
  return apiRequest(`/prescriptions?${params.toString()}`)
}

export async function getPrescription(prescriptionId) {
  return apiRequest(`/prescriptions/${prescriptionId}`)
}

export async function getPrescriptionDocumentAccess(prescriptionId) {
  return apiRequest(`/prescriptions/${prescriptionId}/document-access`)
}
