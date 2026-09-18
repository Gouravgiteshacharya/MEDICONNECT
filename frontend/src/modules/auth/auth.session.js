import { ApiError, createHttpClient } from '../../api/http.client.js'
import { createAuthApi } from './auth.api.js'

export function createAuthSession({ request = createHttpClient() } = {}) {
  const api = createAuthApi(request)
  const listeners = new Set()
  let token = null
  let generation = 0
  let controller
  let pending = false
  let state = { status: 'AUTH_CHECKING', user: null, message: '' }
  function publish(status, user = null, message = '') {
    state = { status, user, message }
    listeners.forEach(listener => listener())
  }
  function clear(message = '') {
    generation += 1
    controller?.abort()
    token = null
    pending = false
    publish('UNAUTHENTICATED', null, message)
  }
  async function authenticate(credentials) {
    if (pending) return
    if (!credentials && !token) { publish('UNAUTHENTICATED'); return }
    pending = true
    const version = ++generation
    controller = new AbortController()
    const signal = controller.signal
    publish('AUTH_CHECKING')
    let verifying = !credentials
    try {
      if (credentials) {
        const nextToken = await api.login(credentials.email, credentials.password, signal)
        if (version !== generation) return
        token = nextToken
      }
      verifying = true
      const user = await api.me(token, signal)
      if (version !== generation) return
      publish(user.role === 'ADMIN' ? 'AUTHENTICATED_ADMIN' : 'AUTHENTICATED_NON_ADMIN', user)
    } catch (error) {
      if (version !== generation) return
      if (error.status === 401) clear(verifying ? 'Your session has expired. Please sign in again.' : 'Unable to sign in. Check your credentials and try again.')
      else if (error.status === 403) publish('AUTHENTICATED_NON_ADMIN', null, 'Access denied. This account is not authorized for Operations.')
      else publish('AUTH_ERROR', null, error.kind === 'network' ? 'Unable to reach the service. Check your connection and try again.' : 'Unable to verify your session. Please try again.')
    } finally {
      if (version === generation) pending = false
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    restore: () => authenticate(),
    login: (email, password) => authenticate({ email, password }),
    logout: () => clear(),
    // Future API modules use this boundary, without reading the token or React state.
    async request(path, options = {}) {
      if (!token || !state.user) throw new ApiError('http', 401, 'AUTH_REQUIRED')
      const version = generation
      try {
        const data = await request(path, { ...options, token })
        if (version !== generation) throw new DOMException('Session changed', 'AbortError')
        return data
      } catch (error) {
        if (version === generation) {
          if (error.status === 401) clear('Your session has expired. Please sign in again.')
          if (error.status === 403) publish('AUTHENTICATED_NON_ADMIN', state.user, 'Access denied. You are signed in but cannot access this workspace.')
        }
        throw error
      }
    },
  }
}
