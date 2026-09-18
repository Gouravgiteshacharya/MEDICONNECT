import { ApiError } from '../../api/http.client.js'

export function createAuthApi(request) {
  return {
    async login(email, password, signal) {
      const data = await request('/auth/login', { method: 'POST', body: { email: email.trim(), password }, signal })
      if (typeof data?.token !== 'string' || !data.token) throw new ApiError('response')
      return data.token
    },
    async me(token, signal) {
      const data = await request('/auth/me', { token, signal })
      const user = data?.user
      if (typeof user?.id !== 'string' || typeof user?.name !== 'string' || !['ADMIN', 'CUSTOMER', 'DELIVERY_PARTNER', 'PHARMACY_STAFF'].includes(user?.role)) throw new ApiError('response')
      return { id: user.id, name: user.name, role: user.role }
    },
  }
}
