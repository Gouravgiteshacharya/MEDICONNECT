import { useEffect, useState } from 'react'
import {
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import { useAuth } from './context/AuthContext'
import CustomerAuthModal from './features/customer/CustomerAuthModal'
import LandingPage from './pages/LandingPage'
import {
  canRoleAccessPath,
  getRoleHome,
  USER_ROLES,
} from './app/roleRouting'

function getSafeNextPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return ''
  }

  return value
}

function App() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    user,
    authenticated,
    initializing,
    logout,
  } = useAuth()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authAudience, setAuthAudience] = useState('customer')
  const [leaving, setLeaving] = useState(false)

  const requestedAuthMode = searchParams.get('auth')
  const requestedAuthAudience =
    searchParams.get('audience') === 'staff' ? 'staff' : 'customer'
  const nextPath = getSafeNextPath(searchParams.get('next'))

  useEffect(() => {
    if (initializing) return

    if (
      !authenticated &&
      (requestedAuthMode === 'login' || requestedAuthMode === 'register')
    ) {
      setAuthMode(requestedAuthMode)
      setAuthAudience(requestedAuthAudience)
      setAuthOpen(true)
    }

    if (authenticated && requestedAuthMode) {
      navigate(getRoleHome(user?.role), { replace: true })
    }
  }, [
    authenticated,
    initializing,
    navigate,
    requestedAuthMode,
    requestedAuthAudience,
    user?.role,
  ])

  useEffect(() => {
    if (!initializing && authenticated && !requestedAuthMode) {
      navigate(getRoleHome(user?.role), { replace: true })
    }
  }, [authenticated, initializing, navigate, requestedAuthMode, user?.role])

  function transitionTo(path) {
    const prefersReducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches

    if (prefersReducedMotion) {
      navigate(path)
      return
    }

    setLeaving(true)
    window.setTimeout(() => navigate(path), 180)
  }

  function openSearch(query = '') {
    const searchQuery = typeof query === 'string' ? query : ''
    const params = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''
    transitionTo(`/app/search${params}`)
  }

  function openAuth(mode = 'login', audience = 'customer') {
    const audienceParam = audience === 'staff' ? '&audience=staff' : ''
    navigate(`/?auth=${mode}${audienceParam}`)
    setAuthMode(mode)
    setAuthAudience(audience)
    setAuthOpen(true)
  }

  function closeAuth() {
    setAuthOpen(false)

    if (requestedAuthMode) {
      navigate('/', { replace: true })
    }
  }

  function handleAuthenticated(nextUser, { mode } = {}) {
    if (mode === 'register') {
      navigate(getRoleHome(USER_ROLES.CUSTOMER), { replace: true })
      return
    }

    if (nextPath && canRoleAccessPath(nextUser?.role, nextPath)) {
      navigate(nextPath, { replace: true })
      return
    }

    navigate(getRoleHome(nextUser?.role), { replace: true })
  }

  if (initializing || authenticated) {
    return (
      <main className="route-auth-loading" aria-busy="true">
        <span>M</span>
        <strong>Opening MediConnect...</strong>
      </main>
    )
  }

  return (
    <div className="app">
      <LandingPage
        authenticated={authenticated}
        user={user}
        logout={logout}
        openAuth={openAuth}
        openSearch={openSearch}
        openApp={() => transitionTo(getRoleHome(user?.role))}
        openLanding={() => navigate('/')}
        leaving={leaving}
      />

      <CustomerAuthModal
        open={authOpen}
        initialMode={authMode}
        audience={authAudience}
        onClose={closeAuth}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  )
}

export default App
