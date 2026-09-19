const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE = configuredApiBase || (
  import.meta.env.PROD
    ? 'https://mediconnect-3jsq.onrender.com/api/v1'
    : 'http://localhost:4000/api/v1'
)

if (import.meta.env.PROD && !API_BASE.startsWith('https://')) {
  throw new Error('Production API configuration must use HTTPS.')
}

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

  let response

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      headers: requestHeaders,
      body:
        body !== undefined &&
        !(body instanceof FormData) &&
        typeof body !== 'string'
          ? JSON.stringify(body)
          : body,
    })
  } catch (cause) {
    const error = new Error(
      'Unable to reach MediConnect right now. Please check your connection and try again.',
    )
    error.code = 'NETWORK_UNAVAILABLE'
    error.cause = cause
    throw error
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload?.error?.message ??
      payload?.error ??
      payload?.message ??
      'Something went wrong. Please try again.'

    const error = new Error(
      typeof message === 'string'
        ? message
        : 'Something went wrong. Please try again.',
    )
    error.code = payload?.error?.code ?? payload?.code
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload?.data ?? payload
}

export { API_BASE }
