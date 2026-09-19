import { apiRequest } from '../../services/apiClient'

export function labelFromEnum(value) {
  if (!value) return 'Not available'

  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatAdminDate(value) {
  if (!value) return 'Not available'

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function withQuery(path, params) {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  })

  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

export async function getAdminOperationsSummary() {
  return apiRequest('/admin/operations/summary')
}

export async function listAdminPharmacies(params = {}) {
  return apiRequest(withQuery('/admin/pharmacies', params))
}

export async function getAdminPharmacy(pharmacyId) {
  return apiRequest(`/admin/pharmacies/${pharmacyId}`)
}

export async function listAdminInventory(params = {}) {
  return apiRequest(withQuery('/admin/inventory', params))
}

export async function listAdminOrders(params = {}) {
  return apiRequest(withQuery('/admin/orders', params))
}

export async function getAdminOrder(orderId) {
  return apiRequest(`/admin/orders/${orderId}`)
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

export async function listPartnerApplications(type, params = {}) {
  return apiRequest(withQuery(`/admin/applications/${type}`, params))
}

export async function getPartnerApplication(type, applicationId) {
  return apiRequest(`/admin/applications/${type}/${applicationId}`)
}

export async function transitionPartnerApplication(type, applicationId, body) {
  return apiRequest(`/admin/applications/${type}/${applicationId}/status`, {
    method: 'PATCH', body,
  })
}

export async function recordPartnerVerification(type, applicationId, body) {
  const action = type === 'pharmacies' ? 'field-visit' : 'office-verification'
  return apiRequest(`/admin/applications/${type}/${applicationId}/${action}`, {
    method: 'PUT', body,
  })
}

export async function approvePartnerApplication(type, applicationId) {
  return apiRequest(`/admin/applications/${type}/${applicationId}/approve`, {
    method: 'POST', body: {},
  })
}

export async function getPharmacyApplicationPhotoAccess(applicationId) {
  return apiRequest(`/admin/applications/pharmacies/${applicationId}/photo-access`)
}
