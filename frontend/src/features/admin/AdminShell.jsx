import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import './AdminShell.css'

const navItems = [
  { label: 'Overview', path: '/admin' },
  { label: 'Pharmacies', path: '/admin/pharmacies' },
  { label: 'Inventory', path: '/admin/inventory' },
  { label: 'Orders', path: '/admin/orders' },
  { label: 'Deliveries', path: '/admin/deliveries' },
  { label: 'Riders', path: '/admin/riders' },
  { label: 'Support', path: '/admin/support' },
  { label: 'Risk', path: '/admin/risk' },
  { label: 'Metrics', path: '/admin/metrics' },
]

export default function AdminShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { authenticated, initializing, user } = useAuth()

  if (initializing) {
    return (
      <main className="admin-access">
        <section className="admin-access-card">
          <strong>Loading operations workspace...</strong>
        </section>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="admin-access">
        <section className="admin-access-card">
          <span>M</span>
          <h1>Operations sign-in required.</h1>
          <p>MediConnect Operations is available only to authenticated admins.</p>
          <button type="button" onClick={() => navigate('/app/profile')}>
            Go to sign in
          </button>
        </section>
      </main>
    )
  }

  if (user?.role !== 'ADMIN') {
    return (
      <main className="admin-access">
        <section className="admin-access-card">
          <span>M</span>
          <h1>Admin access required.</h1>
          <p>Your current MediConnect account role is {user?.role || 'unknown'}.</p>
          <button type="button" onClick={() => navigate('/app')}>
            Back to customer app
          </button>
        </section>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button
          type="button"
          className="admin-brand"
          onClick={() => navigate('/')}
        >
          <span>M</span>
          <strong>MediConnect Operations</strong>
        </button>

        <nav aria-label="Operations navigation">
          {navItems.map((item) => (
            <button
              key={item.path}
              type="button"
              className={
                location.pathname === item.path ||
                (item.path !== '/admin' &&
                  location.pathname.startsWith(item.path))
                  ? 'active'
                  : ''
              }
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="admin-content">
        <Outlet />
      </div>

      <nav className="admin-mobile-nav" aria-label="Operations navigation">
        {navItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className={
              location.pathname === item.path ||
              (item.path !== '/admin' &&
                location.pathname.startsWith(item.path))
                ? 'active'
                : ''
            }
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
