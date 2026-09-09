import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '../features/auth/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser()
      setUser(currentUser)
      return currentUser
    } catch {
      logoutRequest()
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setInitializing(false))
  }, [refreshUser])

  const login = useCallback(async (credentials) => {
    const result = await loginRequest(credentials)
    setUser(result.user)
    return result.user
  }, [])

  const register = useCallback(async (details) => {
    const result = await registerRequest(details)
    setUser(result.user)
    return result.user
  }, [])

  const logout = useCallback(() => {
    logoutRequest()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      initializing,
      authenticated: Boolean(user),
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, initializing, login, register, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }

  return context
}
