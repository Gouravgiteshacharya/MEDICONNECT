import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from './context/AuthContext'
import CustomerAuthModal from './features/customer/CustomerAuthModal'
import LandingPage from './pages/LandingPage'

function App() {
  const navigate = useNavigate()
  const { user, authenticated, logout } = useAuth()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')

  function openSearch(query = '') {
    const searchQuery = typeof query === 'string' ? query : ''
    const params = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''
    navigate(`/app/search${params}`)
  }

  function openAuth(mode = 'login') {
    setAuthMode(mode)
    setAuthOpen(true)
  }

  return (
    <div className="app">
      <LandingPage
        authenticated={authenticated}
        user={user}
        logout={logout}
        openAuth={openAuth}
        openSearch={openSearch}
        openApp={() => navigate('/app')}
      />

      <CustomerAuthModal
        open={authOpen}
        initialMode={authMode}
        onClose={() => setAuthOpen(false)}
      />
    </div>
  )
}

export default App
