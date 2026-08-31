import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'
const token = () => localStorage.getItem('mediconnect_access_token')
async function api(path, options = {}) {
  if (!token()) throw new Error('Secure rider sign-in is not connected yet.')
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.')
  return body.data
}
const time = (value) => value ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Not available'
const label = (value) => value?.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())

function AssignmentCard({ assignment, onAction, busy }) {
  const { order } = assignment
  const destination = [order.deliveryAddressLabelSnapshot, order.deliveryAddressLine1Snapshot, order.deliveryLandmarkSnapshot].filter(Boolean).join(' · ')
  const navigate = (lat, lng) => lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null
  return <article className="card assignment-card">
    <div className="card-top"><div><span className="eyebrow">Active delivery</span><h2>{order.orderNumber}</h2></div><span className="status blue">{label(assignment.status)}</span></div>
    <div className="route-line"><span className="route-dot pickup">P</span><div><b>{order.pharmacy.name}</b><p>{order.pharmacy.addressLine1}</p></div>{navigate(order.pharmacy.latitude, order.pharmacy.longitude) && <a className="text-link" href={navigate(order.pharmacy.latitude, order.pharmacy.longitude)} target="_blank" rel="noreferrer">Navigate</a>}</div>
    <div className="route-stem" />
    <div className="route-line"><span className="route-dot drop">D</span><div><b>Customer destination</b><p>{destination || 'Address available after assignment'}</p></div>{navigate(order.deliveryLatitudeSnapshot, order.deliveryLongitudeSnapshot) && <a className="text-link" href={navigate(order.deliveryLatitudeSnapshot, order.deliveryLongitudeSnapshot)} target="_blank" rel="noreferrer">Navigate</a>}</div>
    <div className="meta-row"><span>{order.deliveryDistanceKm ? `${order.deliveryDistanceKm.toFixed(1)} km` : 'Distance unavailable'}</span><span>{order.quotedEtaMinutes ? `${order.quotedEtaMinutes} min quoted` : 'ETA unavailable'}</span></div>
    <div className="action-grid">
      {assignment.status === 'ACCEPTED' && <><button className="secondary" disabled={busy} onClick={() => onAction(assignment.id, 'arrive-pharmacy')}>Arrived at pharmacy</button><button disabled={busy} onClick={() => onAction(assignment.id, 'pickup')}>Confirm pickup</button></>}
      {assignment.status === 'PICKED_UP' && <button disabled={busy} onClick={() => onAction(assignment.id, 'start-delivery')}>Start delivery</button>}
      {assignment.status === 'OUT_FOR_DELIVERY' && <><button className="danger" disabled={busy} onClick={() => onAction(assignment.id, 'fail', { reason: 'Delivery could not be completed' })}>Report issue</button><button disabled={busy} onClick={() => onAction(assignment.id, 'deliver')}>Mark delivered</button></>}
    </div>
  </article>
}

function App() {
  const [dashboard, setDashboard] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = useCallback(async (quiet = false) => { if (!quiet) setLoading(true); try { setDashboard(await api('/riders/me/dashboard')); setError('') } catch (err) { setError(err.message) } finally { setLoading(false) } }, [])
  // Initial API synchronization is intentionally effect-driven; subsequent refreshes use the same stable callback.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { load(true); const id = setInterval(() => token() && load(true), 15000); return () => clearInterval(id) }, [load])
  async function run(work) { setBusy(true); try { await work(); await load(true); setError('') } catch (err) { setError(err.message) } finally { setBusy(false) } }
  const availability = (value) => run(() => api('/riders/me/availability', { method: 'PATCH', body: JSON.stringify({ availability: value }) }))
  const shareLocation = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(({ coords }) => run(() => api('/riders/me/location', { method: 'PATCH', body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }) })), (err) => setError(err.message), { enableHighAccuracy: true, timeout: 10000 }) : setError('Location is not supported by this browser.')
  const offer = (id, action) => run(() => api(`/delivery-assignments/${id}/${action}`, { method: 'POST', body: '{}' }))
  const lifecycle = (id, action, body) => run(() => api(`/delivery-lifecycle/${id}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) }))
  if (loading && !dashboard) return <main className="shell centered"><div className="loader" /><p>Preparing your delivery workspace…</p></main>
  if (!dashboard) return <main className="shell centered"><div className="brand-mark">M</div><h1>Rider access required</h1><p>{error}</p><p className="muted">This dashboard uses the secure token created by MediConnect authentication.</p><button onClick={() => load()}>Try again</button></main>
  const { rider, location, workload, offers, activeAssignments, recentHistory } = dashboard
  return <main className="shell">
    <header><div><div className="brand"><span className="brand-mark small">M</span><span>MediConnect</span></div><p className="greeting">Good day, {rider.name.split(' ')[0]}</p></div><div className={`availability ${rider.availability.toLowerCase()}`}><span />{label(rider.availability)}</div></header>
    {error && <div className="alert" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
    <section className="status-panel"><div><span className="eyebrow">Availability</span><h1>{rider.availability === 'AVAILABLE' ? 'Ready for deliveries' : rider.availability === 'BUSY' ? 'Delivery in progress' : 'You are not receiving offers'}</h1><p>{label(rider.vehicleType)}{rider.vehicleNumber ? ` · ${rider.vehicleNumber}` : ''}</p></div><div className="toggle-actions"><button className={rider.availability === 'AVAILABLE' ? '' : 'secondary'} disabled={busy || rider.availability === 'BUSY'} onClick={() => availability(rider.availability === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE')}>{rider.availability === 'AVAILABLE' ? 'Go offline' : 'Go online'}</button><button className="location-button" disabled={busy} onClick={shareLocation}>Update location</button></div><div className="location-state"><span className={`signal ${location.freshness.toLowerCase()}`} />Location {label(location.freshness)} · {time(location.lastUpdatedAt)}</div></section>
    <section className="metrics"><div><b>{workload.actionableOffers}</b><span>Offers</span></div><div><b>{workload.activeAssignments}</b><span>Active</span></div><div><b>{workload.recentDeliveries}</b><span>Completed</span></div></section>
    {offers.length > 0 && <section><div className="section-heading"><div><span className="eyebrow">New requests</span><h2>Delivery offers</h2></div><button className="icon-button" onClick={() => load()}>↻</button></div>{offers.map((item) => <article className="card offer-card" key={item.id}><div><span className="status amber">Offer</span><h2>{item.order.orderNumber}</h2><p><b>{item.order.pharmacy.name}</b> → {item.order.deliveryAddressLabelSnapshot || 'Customer destination'}</p><small>Expires at {time(item.expiresAt)}</small></div><div className="action-grid"><button className="secondary" disabled={busy} onClick={() => offer(item.id, 'decline')}>Decline</button><button disabled={busy} onClick={() => offer(item.id, 'accept')}>Accept</button></div></article>)}</section>}
    <section><div className="section-heading"><div><span className="eyebrow">Your route</span><h2>Current deliveries</h2></div></div>{activeAssignments.length ? activeAssignments.map((item) => <AssignmentCard key={item.id} assignment={item} onAction={lifecycle} busy={busy} />) : <div className="empty"><span>✓</span><h3>No active delivery</h3><p>Go online and keep your location fresh to receive offers.</p></div>}</section>
    <section><div className="section-heading"><div><span className="eyebrow">Recent activity</span><h2>Delivery history</h2></div></div><div className="history card">{recentHistory.length ? recentHistory.map((item) => <div className="history-row" key={item.id}><span className={`history-icon ${item.status.toLowerCase()}`}>✓</span><div><b>{item.order.orderNumber}</b><p>{item.order.pharmacy.name}</p></div><div className="history-status"><b>{label(item.status)}</b><small>{time(item.deliveredAt ?? item.assignedAt)}</small></div></div>) : <p className="muted">No recent deliveries yet.</p>}</div></section>
    <footer>Location updates are shared only during delivery operations.</footer>
  </main>
}
export default App
