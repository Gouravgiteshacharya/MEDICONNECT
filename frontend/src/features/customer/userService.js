import { apiRequest } from '../../services/apiClient'

export async function getProfile() {
  const result = await apiRequest('/users/me')
  return result.user
}

export async function updateProfile(input) {
  const result = await apiRequest('/users/me', {
    method: 'PATCH',
    body: input,
  })

  return result.user
}
