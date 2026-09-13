import { apiRequest } from '../../services/apiClient'

export async function listAddresses() {
  const result = await apiRequest('/users/me/addresses')
  return result.addresses ?? []
}

export async function createAddress(input) {
  const result = await apiRequest('/users/me/addresses', {
    method: 'POST',
    body: input,
  })

  return result.address
}

export async function updateAddress(addressId, input) {
  const result = await apiRequest(`/users/me/addresses/${addressId}`, {
    method: 'PATCH',
    body: input,
  })

  return result.address
}

export async function deleteAddress(addressId) {
  return apiRequest(`/users/me/addresses/${addressId}`, {
    method: 'DELETE',
  })
}
