import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatDate, labelFromEnum, listPharmacyPrescriptions } from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyPrescriptions() {
  const navigate = useNavigate()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()
  const [prescriptions, setPrescriptions] = useState([])
  const [status, setStatus] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(cursor) {
    setLoading(true)
    setError('')
    try {
      const result = await listPharmacyPrescriptions(pharmacyId, { status, cursor })
      setPrescriptions((current) => cursor ? [...current, ...result.prescriptions] : result.prescriptions)
      setNextCursor(result.nextCursor)
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load prescriptions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [pharmacyId, status])

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header"><div><span>PRESCRIPTIONS</span><h1>Prescription review</h1><p>Review states and linked orders from the pharmacy-scoped API.</p></div></header>
      <section className="pharmacy-toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Prescription status"><option value="">All review states</option>{['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED'].map((value) => <option key={value} value={value}>{labelFromEnum(value)}</option>)}</select></section>
      {error && <div className="pharmacy-feedback error">{error}</div>}
      <section className="pharmacy-table-wrap"><table className="pharmacy-table"><thead><tr><th>Prescription</th><th>Order</th><th>Review state</th><th>Uploaded</th><th>Reviewed</th><th /></tr></thead><tbody>
        {prescriptions.map((item) => <tr key={item.id}><td><strong>{item.id}</strong>{item.supersededByPrescription && <small>Superseded</small>}</td><td><strong>{item.order.orderNumber}</strong><small>{labelFromEnum(item.order.status)}</small></td><td><span className="pharmacy-badge">{labelFromEnum(item.status)}</span></td><td>{formatDate(item.uploadedAt)}</td><td>{formatDate(item.reviewedAt)}</td><td><button type="button" className="pharmacy-secondary-button" onClick={() => navigate(pathWithPharmacy(`/pharmacy/prescriptions/${item.id}`))}>Open</button></td></tr>)}
      </tbody></table></section>
      {!loading && prescriptions.length === 0 && <div className="pharmacy-message">No prescriptions match this review state.</div>}
      {nextCursor && <button type="button" className="pharmacy-secondary-button pharmacy-load-more" disabled={loading} onClick={() => load(nextCursor)}>{loading ? 'Loading...' : 'Load more'}</button>}
    </main>
  )
}
