import {
  apiRequest,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '../../services/apiClient'

export async function login(credentials) {
  const result = await apiRequest('/auth/login', {
    method: 'POST',
    auth: false,
    body: credentials,
  })

  setAccessToken(result.token)

  return result
}

export async function register(details) {
  const result = await apiRequest('/auth/register', {
    method: 'POST',
    auth: false,
    body: details,
  })

  setAccessToken(result.token)

  return result
}

export async function getCurrentUser() {
  if (!getAccessToken()) {
    return null
  }

  const result = await apiRequest('/auth/me')

  return result.user
}

export function logout() {
  clearAccessToken()
}
