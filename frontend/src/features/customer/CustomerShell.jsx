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

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h2l1.5 9h8.8l1.3-6.5H8" />
      <circle cx="10" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
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

  const activeTab = location.pathname.startsWith('/app/search') ||
    location.pathname.startsWith('/app/results') ||
    location.pathname.startsWith('/app/pharmacy')
    ? 'search'
    : location.pathname.startsWith('/app/orders')
      ? 'orders'
      : location.pathname.startsWith('/app/cart') ||
          location.pathname.startsWith('/app/checkout') ||
          location.pathname.startsWith('/app/delivery-address')
        ? 'cart'
        : location.pathname.startsWith('/app/profile')
          ? 'profile'
          : 'home'

  const navItems = [
    {
      key: 'home',
      label: 'Home',
      path: '/app',
      icon: <HomeIcon />,
    },
    {
      key: 'search',
      label: 'Search',
      path: '/app/search',
      icon: <SearchIcon />,
    },
    {
      key: 'cart',
      label: 'Cart',
      path: '/app/cart',
      icon: <CartIcon />,
    },
    {
      key: 'orders',
      label: 'Orders',
      path: '/app/orders',
      icon: <OrdersIcon />,
    },
    {
      key: 'profile',
      label: 'Profile',
      path: '/app/profile',
      icon: <ProfileIcon />,
    },
  ]

  return (
    <div className="customer-shell">
      <aside className="customer-shell-sidebar" aria-label="Customer workspace">
        <button
          className="customer-shell-brand"
          type="button"
          onClick={() => navigate('/app')}
        >
          <span>M</span>
          <strong>MediConnect</strong>
        </button>

        <nav aria-label="Customer navigation">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={activeTab === item.key ? 'active' : ''}
              type="button"
              onClick={() => navigate(item.path)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="customer-shell-content">
        <Outlet />
      </div>

      <nav className="customer-shell-nav" aria-label="Customer navigation">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={activeTab === item.key ? 'active' : ''}
            type="button"
            onClick={() => navigate(item.path)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
