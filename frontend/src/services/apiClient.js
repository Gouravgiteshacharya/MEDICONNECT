const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1'

const ACCESS_TOKEN_KEY = 'mediconnect_access_token'

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token) {
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  }
}

export function clearAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export async function apiRequest(path, options = {}) {
  const {
    auth = true,
    headers = {},
    body,
    ...requestOptions
  } = options

  const token = getAccessToken()

  if (auth && !token) {
    throw new Error('Authentication required.')
  }

  const requestHeaders = {
    ...headers,
  }

  if (auth && token) {
    requestHeaders.Authorization = `Bearer ${token}`
  }

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders['Content-Type'] ??= 'application/json'
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    headers: requestHeaders,
    body:
      body !== undefined &&
      !(body instanceof FormData) &&
      typeof body !== 'string'
        ? JSON.stringify(body)
        : body,
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload?.error?.message ??
      payload?.error ??
      payload?.message ??
      'Something went wrong. Please try again.'

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Something went wrong. Please try again.',
    )
  }

  return payload?.data ?? payload
}

export { API_BASE }
