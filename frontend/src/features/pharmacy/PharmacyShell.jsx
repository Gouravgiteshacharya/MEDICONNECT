import {
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { useEffect, useState } from 'react'

import { useAuth } from '../../context/AuthContext'
import { getMyPharmacyMemberships, labelFromEnum } from './pharmacyService'
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
  const hasAccessRole = user?.role === 'PHARMACY_STAFF'
  const [memberships, setMemberships] = useState([])
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState('')

  const requestedPharmacyId = searchParams.get('pharmacyId') || getStoredPharmacyId()
  const selectedMembership = memberships.find(
    (membership) => membership.pharmacy.id === requestedPharmacyId,
  ) ?? memberships[0]
  const pharmacyId = selectedMembership?.pharmacy.id ?? ''

  useEffect(() => {
    if (!authenticated || !hasAccessRole) {
      setWorkspaceLoading(false)
      return
    }

    let active = true
    setWorkspaceLoading(true)
    getMyPharmacyMemberships()
      .then((result) => {
        if (!active) return
        setMemberships(result)
        setWorkspaceError('')
      })
      .catch((requestError) => {
        if (!active) return
        setWorkspaceError(
          requestError?.message || 'Unable to load your pharmacy memberships.',
        )
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false)
      })

    return () => { active = false }
  }, [authenticated, hasAccessRole])

  useEffect(() => {
    if (!pharmacyId) return
    localStorage.setItem(PHARMACY_ID_KEY, pharmacyId)
    if (searchParams.get('pharmacyId') !== pharmacyId) {
      setSearchParams({ pharmacyId }, { replace: true })
    }
  }, [pharmacyId, searchParams, setSearchParams])

  function selectPharmacy(event) {
    const nextPharmacyId = event.target.value
    localStorage.setItem(PHARMACY_ID_KEY, nextPharmacyId)
    setSearchParams({ pharmacyId: nextPharmacyId })
  }

  function pathWithPharmacy(path) {
    if (!pharmacyId) return path
    return `${path}?pharmacyId=${encodeURIComponent(pharmacyId)}`
  }

  if (initializing || workspaceLoading) {
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

  if (workspaceError) {
    return (
      <main className="pharmacy-access">
        <section className="pharmacy-access-card">
          <span>M</span>
          <h1>Unable to open pharmacy workspace.</h1>
          <p>{workspaceError}</p>
        </section>
      </main>
    )
  }

  if (!pharmacyId) {
    return (
      <main className="pharmacy-access">
        <section className="pharmacy-access-card">
          <span>M</span>
          <h1>No active pharmacy membership.</h1>
          <p>Your account is not currently assigned to an active pharmacy workspace.</p>
        </section>
      </main>
    )
  }

  return (
    <div className="pharmacy-shell">
      <aside className="pharmacy-sidebar">
        <button
          type="button"
          className="pharmacy-brand"
          onClick={() => navigate('/')}
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

        <div className="pharmacy-switcher">
          <label>
            <span>{memberships.length > 1 ? 'Active pharmacy' : 'Workspace'}</span>
            {memberships.length > 1 ? (
              <select value={pharmacyId} onChange={selectPharmacy}>
                {memberships.map((membership) => (
                  <option key={membership.id} value={membership.pharmacy.id}>
                    {membership.pharmacy.name} · {labelFromEnum(membership.role)}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{selectedMembership.pharmacy.name}</strong>
            )}
          </label>
        </div>
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
