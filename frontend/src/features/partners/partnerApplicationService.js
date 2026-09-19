import { apiRequest } from '../../services/apiClient'

export function submitPharmacyApplication(form) {
  return apiRequest('/partner/pharmacy/apply', {
    auth: false,
    method: 'POST',
    body: form,
  })
}

export function submitRiderApplication(form) {
  return apiRequest('/partner/rider/apply', {
    auth: false,
    method: 'POST',
    body: form,
  })
}
