import {
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import './PharmacyShell.css'

const PHARMACY_ID_KEY = 'mediconnect_pharmacy_workspace_id'

const navItems = [
  { label: 'Dashboard', path: '/pharmacy' },
  { label: 'Inventory', path: '/pharmacy/inventory' },
  { label: 'Medicines', path: '/pharmacy/medicines' },
  { label: 'Orders', path: '/pharmacy/orders' },
  { label: 'Prescriptions', path: '/pharmacy/prescriptions' },
  { label: 'Profile', path: '/pharmacy/profile' },
]

function getStoredPharmacyId() {
  return localStorage.getItem(PHARMACY_ID_KEY) ?? ''
}

export default function PharmacyShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { authenticated, initializing, user } = useAuth()

  const pharmacyId = searchParams.get('pharmacyId') || getStoredPharmacyId()
  const hasAccessRole = user?.role === 'PHARMACY_STAFF'

  function selectPharmacy(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextPharmacyId = String(formData.get('pharmacyId') ?? '').trim()

    if (!nextPharmacyId) return

    localStorage.setItem(PHARMACY_ID_KEY, nextPharmacyId)
    setSearchParams({ pharmacyId: nextPharmacyId })
  }

  function pathWithPharmacy(path) {
    if (!pharmacyId) return path
    return `${path}?pharmacyId=${encodeURIComponent(pharmacyId)}`
  }

  if (initializing) {
    return (
      <main className="pharmacy-access">
        <div className="pharmacy-access-card">
          <strong>Loading pharmacy workspace...</strong>
        </div>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <main className="pharmacy-access">
        <div className="pharmacy-access-card">
          <span>M</span>
          <h1>Pharmacy sign-in required.</h1>
          <p>
            This operational workspace is available only after MediConnect
            authentication.
          </p>
          <button type="button" onClick={() => navigate('/app/profile')}>
            Go to sign in
          </button>
        </div>
      </main>
    )
  }

  if (!hasAccessRole) {
    return (
      <main className="pharmacy-access">
        <div className="pharmacy-access-card">
          <span>M</span>
          <h1>Pharmacy staff access required.</h1>
          <p>
            Your current MediConnect account role is {user?.role || 'unknown'}.
          </p>
          <button type="button" onClick={() => navigate('/app')}>
            Back to customer app
          </button>
        </div>
      </main>
    )
  }

  if (!pharmacyId) {
    return (
      <main className="pharmacy-access">
        <form className="pharmacy-access-card" onSubmit={selectPharmacy}>
          <span>M</span>
          <h1>Select pharmacy workspace.</h1>
          <p>
            The backend currently requires a pharmacy ID in pharmacy route URLs.
            Membership is still validated by the API before data is returned.
          </p>
          <label>
            <span>Pharmacy ID</span>
            <input
              name="pharmacyId"
              placeholder="Pharmacy UUID"
              autoComplete="off"
            />
          </label>
          <button type="submit">Open workspace</button>
        </form>
      </main>
    )
  }

  return (
    <div className="pharmacy-shell">
      <aside className="pharmacy-sidebar">
        <button
          type="button"
          className="pharmacy-brand"
          onClick={() => navigate(pathWithPharmacy('/pharmacy'))}
        >
          <span>M</span>
          <strong>MediConnect Pharmacy</strong>
        </button>

        <nav aria-label="Pharmacy navigation">
          {navItems.map((item) => (
            <button
              key={item.path}
              type="button"
              className={
                location.pathname === item.path ||
                (item.path !== '/pharmacy' &&
                  location.pathname.startsWith(item.path))
                  ? 'active'
                  : ''
              }
              onClick={() => navigate(pathWithPharmacy(item.path))}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <form className="pharmacy-switcher" onSubmit={selectPharmacy}>
          <label>
            <span>Workspace pharmacy ID</span>
            <input
              name="pharmacyId"
              defaultValue={pharmacyId}
              autoComplete="off"
            />
          </label>
          <button type="submit">Switch</button>
        </form>
      </aside>

      <div className="pharmacy-content">
        <Outlet context={{ pharmacyId, pathWithPharmacy }} />
      </div>

      <nav className="pharmacy-mobile-nav" aria-label="Pharmacy navigation">
        {navItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className={
              location.pathname === item.path ||
              (item.path !== '/pharmacy' &&
                location.pathname.startsWith(item.path))
                ? 'active'
                : ''
            }
            onClick={() => navigate(pathWithPharmacy(item.path))}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
