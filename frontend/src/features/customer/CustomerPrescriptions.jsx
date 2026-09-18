import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { listPrescriptionLibrary } from '../commerce/prescriptionService'
import CustomerAuthModal from './CustomerAuthModal'
import './CustomerPrescriptions.css'

function formatDate(value) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(value) {
  return value?.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || 'Not available'
}

export default function CustomerPrescriptions() {
  const navigate = useNavigate()
  const { authenticated, initializing } = useAuth()
  const [prescriptions, setPrescriptions] = useState([])
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const load = useCallback(async (nextCursor = '', append = false) => {
    if (!authenticated) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const result = await listPrescriptionLibrary({ cursor: nextCursor, limit: 20 })
      setPrescriptions((current) => append ? [...current, ...result.prescriptions] : result.prescriptions)
      setCursor(result.nextCursor || '')
    } catch (requestError) { setError(requestError?.message || 'Unable to load prescriptions.') }
    finally { setLoading(false) }
  }, [authenticated])

  useEffect(() => { if (!initializing) load() }, [initializing, load])

  return <div className="customer-prescriptions-page">
    <header className="customer-prescriptions-header"><div><small>PRESCRIPTIONS</small><strong>Your document library</strong></div><button type="button" onClick={() => navigate('/app/orders')}>Orders</button></header>
    <main className="customer-prescriptions-main">
      {!authenticated && !initializing && <section className="customer-prescriptions-auth"><div>Rx</div><h1>Sign in to view prescriptions.</h1><p>Prescription documents are private and available only to authorized users.</p><button type="button" onClick={() => setAuthOpen(true)}>Sign in</button></section>}
      {authenticated && loading && prescriptions.length === 0 && <div className="customer-prescriptions-message"><strong>Loading prescriptions…</strong></div>}
      {error && <section className="customer-prescriptions-message"><strong>Prescriptions could not load</strong><span>{error}</span><button type="button" onClick={() => load()}>Try again</button></section>}
      {authenticated && !loading && !error && prescriptions.length === 0 && <section className="customer-prescriptions-empty"><div>Rx</div><h1>No prescriptions yet.</h1><p>Secure documents uploaded for prescription orders will appear here.</p><button type="button" onClick={() => navigate('/app/search')}>Search medicines</button></section>}
      {prescriptions.length > 0 && <><section className="customer-prescriptions-summary"><span>PRIVATE LIBRARY</span><h1>{prescriptions.length} prescription{prescriptions.length === 1 ? '' : 's'}</h1><p>Documents open through short-lived authorized links.</p></section><section className="customer-prescriptions-list">
        {prescriptions.map((prescription) => <button key={prescription.id} type="button" className="customer-prescription-card" onClick={() => navigate(`/app/prescriptions/${prescription.id}`)}><div className="customer-prescription-mark">Rx</div><div><div><strong>{prescription.originalFilename || 'Prescription document'}</strong><span>{statusLabel(prescription.status)}</span></div><p>Order {prescription.order.orderNumber}</p><small>Uploaded {formatDate(prescription.uploadedAt)}{prescription.supersededByPrescription ? ' · Superseded' : ''}</small></div><span>→</span></button>)}
      </section>{cursor && <button className="customer-prescriptions-load-more" type="button" disabled={loading} onClick={() => load(cursor, true)}>{loading ? 'Loading…' : 'Load more'}</button>}</>}
    </main>
    <CustomerAuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={() => load()} />
  </div>
}
