export class ApiError extends Error {
  constructor(kind, status = 0, code = null) {
    super(kind === 'network' ? 'Unable to reach the service.' : 'The request could not be completed.')
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

// Base includes /api/v1. Relative by default; configure an API origin at build time.
export function createHttpClient({ baseUrl = '/api/v1', fetchImpl = globalThis.fetch } = {}) {
  return async function request(path, { method = 'GET', body, token, signal } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      throw new ApiError('configuration')
    }
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method, signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error
      throw new ApiError('network')
    }
    let data
    try { data = await response.json() } catch {
      if (!response.ok) throw new ApiError('http', response.status)
      throw new ApiError('response', response.status)
    }
    if (!response.ok) {
      const code = typeof data?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.code) ? data.code : null
      // Preserve status/code, never retain an arbitrary backend message or body.
      throw new ApiError('http', response.status, code)
    }
    return data
  }
}
