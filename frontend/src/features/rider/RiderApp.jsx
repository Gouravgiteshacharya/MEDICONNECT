import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { API_BASE, getAccessToken } from '../../services/apiClient'
import './RiderApp.css'

async function riderRequest(path, options = {}) {
  const token = getAccessToken()
  if (!token) throw new Error('Your rider session has expired. Please sign in again.')

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.')
  return body.data
}

function formatTime(value) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatLabel(value = '') {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function navigationUrl(latitude, longitude) {
  if (latitude == null || longitude == null) return ''
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}

function AssignmentCard({ assignment, arrived, busy, onLifecycle, onReportFailure }) {
  const { order } = assignment
  const pharmacyRoute = navigationUrl(order.pharmacy.latitude, order.pharmacy.longitude)
  const customerRoute = navigationUrl(
    order.deliveryLatitudeSnapshot,
    order.deliveryLongitudeSnapshot,
  )
  const destination = [
    order.deliveryAddressLabelSnapshot,
    order.deliveryAddressLine1Snapshot,
    order.deliveryLandmarkSnapshot,
  ].filter(Boolean).join(' · ')

  let primaryAction = null
  if (assignment.status === 'ACCEPTED') {
    primaryAction = arrived
      ? { label: 'Confirm pickup', action: 'pickup' }
      : { label: 'I have arrived', action: 'arrive-pharmacy' }
  } else if (assignment.status === 'PICKED_UP') {
    primaryAction = { label: 'Start delivery', action: 'start-delivery' }
  } else if (assignment.status === 'OUT_FOR_DELIVERY') {
    primaryAction = { label: 'Mark delivered', action: 'deliver' }
  }

  const navigationLink = assignment.status === 'ACCEPTED' ? pharmacyRoute : customerRoute
  const navigationLabel = assignment.status === 'ACCEPTED'
    ? 'Navigate to pharmacy'
    : 'Navigate to customer'

  return (
    <article className="rider-task-card">
      <div className="rider-task-head">
        <div>
          <span className="rider-eyebrow">
            {assignment.batchId ? 'Batched delivery' : 'Current delivery'}
          </span>
          <h2>{order.orderNumber}</h2>
        </div>
        <span className="rider-status-chip">{formatLabel(assignment.status)}</span>
      </div>

      <div className="rider-stop-list">
        <div className="rider-stop">
          <span className="rider-stop-mark pickup">P</span>
          <div>
            <small>Pickup</small>
            <strong>{order.pharmacy.name}</strong>
            <p>{order.pharmacy.addressLine1 || 'Pharmacy address unavailable'}</p>
          </div>
        </div>
        <div className="rider-stop-connector" />
        <div className="rider-stop">
          <span className="rider-stop-mark drop">D</span>
          <div>
            <small>Drop</small>
            <strong>{order.deliveryAddressLabelSnapshot || 'Customer address'}</strong>
            <p>{destination || 'Delivery address unavailable'}</p>
          </div>
        </div>
      </div>

      {(order.deliveryDistanceKm || order.quotedEtaMinutes) && (
        <div className="rider-route-facts">
          {order.deliveryDistanceKm && <span>{order.deliveryDistanceKm.toFixed(1)} km</span>}
          {order.quotedEtaMinutes && <span>{order.quotedEtaMinutes} min quoted ETA</span>}
        </div>
      )}

      <div className="rider-task-actions">
        {navigationLink && (
          <a href={navigationLink} target="_blank" rel="noreferrer">
            {navigationLabel}
          </a>
        )}
        {primaryAction && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onLifecycle(assignment.id, primaryAction.action)}
          >
            {primaryAction.label}
          </button>
        )}
      </div>

      {assignment.status === 'OUT_FOR_DELIVERY' && (
        <button
          className="rider-report-action"
          type="button"
          disabled={busy}
          onClick={() => onReportFailure(assignment.id)}
        >
          Report a delivery problem
        </button>
      )}
    </article>
  )
}

export default function RiderApp() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [arrivedAssignmentIds, setArrivedAssignmentIds] = useState(() => new Set())

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setDashboard(await riderRequest('/riders/me/dashboard'))
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard(true)
    const intervalId = window.setInterval(() => {
      if (getAccessToken()) loadDashboard(true)
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [loadDashboard])

  async function run(work) {
    setBusy(true)
    try {
      const result = await work()
      await loadDashboard(true)
      setError('')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  function setAvailability(availability) {
    return run(() => riderRequest('/riders/me/availability', {
      method: 'PATCH',
      body: JSON.stringify({ availability }),
    }))
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setError('Location sharing is not supported by this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => run(() => riderRequest('/riders/me/location', {
        method: 'PATCH',
        body: JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
        }),
      })),
      (locationError) => setError(locationError.message),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function respondToOffer(assignmentId, action) {
    return run(() => riderRequest(`/delivery-assignments/${assignmentId}/${action}`, {
      method: 'POST',
      body: '{}',
    }))
  }

  async function runLifecycle(assignmentId, action, body) {
    const result = await run(() => riderRequest(
      `/delivery-lifecycle/${assignmentId}/${action}`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ))

    if (result && action === 'arrive-pharmacy') {
      setArrivedAssignmentIds((current) => new Set(current).add(assignmentId))
    }
  }

  function reportFailure(assignmentId) {
    const reason = window.prompt('Briefly describe the delivery problem.')?.trim()
    if (reason) runLifecycle(assignmentId, 'fail', { reason })
  }

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  if (loading && !dashboard) {
    return (
      <main className="rider-shell rider-centered" aria-busy="true">
        <div className="rider-loader" />
        <p>Preparing your delivery workspace...</p>
      </main>
    )
  }

  if (!dashboard) {
    return (
      <main className="rider-shell rider-centered">
        <div className="rider-brand-mark">M</div>
        <h1>Rider workspace unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => loadDashboard()}>Try again</button>
      </main>
    )
  }

  const {
    rider,
    location,
    workload,
    offers,
    activeAssignments,
    activeRoute,
    recentHistory,
  } = dashboard
  const isAvailable = rider.availability === 'AVAILABLE'
  const isBusy = rider.availability === 'BUSY'

  return (
    <main className="rider-shell">
      <header className="rider-header">
        <button className="rider-brand" type="button" onClick={() => navigate('/')}>
          <span className="rider-brand-mark small">M</span>
          <span>MediConnect</span>
        </button>
        <button className="rider-logout" type="button" onClick={handleLogout}>Log out</button>
      </header>

      {error && (
        <div className="rider-alert" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError('')}>×</button>
        </div>
      )}

      <section className="rider-status-panel">
        <div className="rider-status-topline">
          <div>
            <span className="rider-eyebrow">Rider status</span>
            <h1>{rider.name}</h1>
          </div>
          <span className={`rider-availability ${rider.availability.toLowerCase()}`}>
            <i />{formatLabel(rider.availability)}
          </span>
        </div>
        <p>
          {isAvailable
            ? 'You are ready to receive delivery offers.'
            : isBusy
              ? 'Your active delivery is in progress.'
              : 'Go online when you are ready to receive deliveries.'}
        </p>
        <div className="rider-status-actions">
          <button
            type="button"
            disabled={busy || isBusy}
            onClick={() => setAvailability(isAvailable ? 'OFFLINE' : 'AVAILABLE')}
          >
            {isAvailable ? 'Go offline' : 'Go online'}
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={shareLocation}>
            Share current location
          </button>
        </div>
        <div className="rider-location-state">
          <i className={location.freshness.toLowerCase()} />
          <span>
            {location.sharing ? 'Location shared' : 'Location not shared'} ·{' '}
            {formatLabel(location.freshness)}
            {location.lastUpdatedAt ? ` at ${formatTime(location.lastUpdatedAt)}` : ''}
          </span>
        </div>
      </section>

      <section className="rider-current-work">
        <div className="rider-section-heading">
          <div>
            <span className="rider-eyebrow">Right now</span>
            <h2>{activeAssignments.length ? 'Current delivery' : 'Ready for work'}</h2>
          </div>
          <button
            className="rider-refresh"
            type="button"
            disabled={busy}
            onClick={() => loadDashboard()}
          >
            Refresh
          </button>
        </div>

        {activeRoute?.stops?.length > 0 && (
          <article className="rider-route-card">
            <div>
              <span className="rider-eyebrow">Active route</span>
              <strong>{activeRoute.stops.length} remaining stops</strong>
            </div>
            <ol>
              {activeRoute.stops.map((stop) => (
                <li key={stop.id}>
                  <span>{stop.sequence}</span>
                  <div>
                    <strong>{stop.addressLabel || formatLabel(stop.stopType)}</strong>
                    <small>
                      {stop.orderNumber || 'Delivery'}
                      {stop.estimatedArrivalAt ? ` · ETA ${formatTime(stop.estimatedArrivalAt)}` : ''}
                    </small>
                  </div>
                  <a href={navigationUrl(stop.latitude, stop.longitude)} target="_blank" rel="noreferrer">
                    Navigate
                  </a>
                </li>
              ))}
            </ol>
          </article>
        )}

        {activeAssignments.length ? activeAssignments.map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            arrived={arrivedAssignmentIds.has(assignment.id)}
            busy={busy}
            onLifecycle={runLifecycle}
            onReportFailure={reportFailure}
          />
        )) : (
          <div className={`rider-empty ${isAvailable ? 'online' : ''}`}>
            <span>{isAvailable ? 'ON' : 'OFF'}</span>
            <h3>{isAvailable ? "You're online" : "You're offline"}</h3>
            <p>
              {isAvailable
                ? 'Waiting for the next delivery offer.'
                : 'Go online to receive delivery offers.'}
            </p>
            {!isAvailable && !isBusy && (
              <button type="button" disabled={busy} onClick={() => setAvailability('AVAILABLE')}>
                Go online
              </button>
            )}
          </div>
        )}
      </section>

      {offers.length > 0 && (
        <section className="rider-offers">
          <div className="rider-section-heading">
            <div>
              <span className="rider-eyebrow">New requests</span>
              <h2>Delivery offers</h2>
            </div>
            <span className="rider-count">{workload.actionableOffers}</span>
          </div>
          {offers.map((offer) => (
            <article className="rider-offer-card" key={offer.id}>
              <div>
                <span className="rider-eyebrow">
                  {offer.batchId ? 'Batch offer' : 'Delivery offer'}
                </span>
                <h3>{offer.order.orderNumber}</h3>
                <p>
                  <strong>{offer.order.pharmacy.name}</strong> to{' '}
                  {offer.order.deliveryAddressLabelSnapshot || 'customer address'}
                </p>
                <small>Expires at {formatTime(offer.expiresAt)}</small>
              </div>
              <div className="rider-offer-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => respondToOffer(offer.id, 'decline')}
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => respondToOffer(offer.id, 'accept')}
                >
                  Accept
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {recentHistory.length > 0 && (
        <section className="rider-history">
          <div className="rider-section-heading">
            <div>
              <span className="rider-eyebrow">Recent</span>
              <h2>Delivery activity</h2>
            </div>
          </div>
          <div className="rider-history-card">
            {recentHistory.map((item) => (
              <div className="rider-history-row" key={item.id}>
                <span>{item.status === 'DELIVERED' ? '✓' : '!'}</span>
                <div>
                  <strong>{item.order.orderNumber}</strong>
                  <small>{item.order.pharmacy.name}</small>
                </div>
                <div>
                  <strong>{formatLabel(item.status)}</strong>
                  <small>{formatTime(item.deliveredAt ?? item.assignedAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="rider-footer">
        Location updates are shared only during delivery operations.
      </footer>
    </main>
  )
}
