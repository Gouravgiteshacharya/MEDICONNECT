import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import './CustomerShell.css'

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20H4Z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4 4" />
    </svg>
  )
}

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c.6-4.1 3-6 7-6s6.4 1.9 7 6" />
    </svg>
  )
}

export default function CustomerShell() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = location.pathname.startsWith('/app/search')
    ? 'search'
    : location.pathname.startsWith('/app/orders')
      ? 'orders'
      : location.pathname.startsWith('/app/profile')
        ? 'profile'
        : 'home'

  return (
    <div className="customer-shell">
      <Outlet />

      <nav className="customer-shell-nav" aria-label="Customer navigation">
        <button
          className={activeTab === 'home' ? 'active' : ''}
          type="button"
          onClick={() => navigate('/app')}
        >
          <HomeIcon />
          <span>Home</span>
        </button>

        <button
          className={activeTab === 'search' ? 'active' : ''}
          type="button"
          onClick={() => navigate('/app/search')}
        >
          <SearchIcon />
          <span>Search</span>
        </button>

        <button
          className={activeTab === 'orders' ? 'active' : ''}
          type="button"
          disabled
        >
          <OrdersIcon />
          <span>Orders</span>
        </button>

        <button
          className={activeTab === 'profile' ? 'active' : ''}
          type="button"
          disabled
        >
          <ProfileIcon />
          <span>Profile</span>
        </button>
      </nav>
    </div>
  )
}
