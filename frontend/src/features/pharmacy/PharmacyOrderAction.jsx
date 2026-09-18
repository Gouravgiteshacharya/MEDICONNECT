import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  completePharmacySelfPickup,
  decidePharmacyOrder,
  formatDate,
  getPharmacyOrder,
  labelFromEnum,
  updatePharmacyOrderPreparation,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyOrderAction() {
  const navigate = useNavigate()
  const { orderId } = useParams()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try { setOrder(await getPharmacyOrder(pharmacyId, orderId)) }
    catch (requestError) { setError(requestError?.message || 'Unable to load this order.') }
  }
  useEffect(() => { load() }, [pharmacyId, orderId])

  async function mutate(request) {
    setBusy(true); setError('')
    try { await request(); await load() }
    catch (requestError) { setError(requestError?.message || 'Unable to update this order.') }
    finally { setBusy(false) }
  }

  return <main className="pharmacy-page">
    <header className="pharmacy-page-header"><div><span>ORDER DETAIL</span><h1>{order?.orderNumber || 'Loading order...'}</h1><p>Read-only backend detail with server-validated operational actions.</p></div><button type="button" className="pharmacy-secondary-button" onClick={() => navigate(pathWithPharmacy('/pharmacy/orders'))}>Back</button></header>
    {error && <div className="pharmacy-feedback error">{error}</div>}
    {order && <>
      <section className="pharmacy-grid pharmacy-metrics">
        <article className="pharmacy-card pharmacy-metric"><small>STATUS</small><strong>{labelFromEnum(order.status)}</strong></article>
        <article className="pharmacy-card pharmacy-metric"><small>FULFILMENT</small><strong>{labelFromEnum(order.fulfillmentMethod)}</strong></article>
        <article className="pharmacy-card pharmacy-metric"><small>ITEMS</small><strong>{order.items.length}</strong></article>
        <article className="pharmacy-card pharmacy-metric"><small>TOTAL</small><strong>₹{order.totalAmount}</strong></article>
      </section>
      <section className="pharmacy-card pharmacy-message"><strong>Timeline</strong><p>Placed {formatDate(order.placedAt)} · Confirmed {formatDate(order.confirmedAt)} · Completed {formatDate(order.completedAt)}</p><div className="pharmacy-row-actions">
        <button type="button" className="pharmacy-button" disabled={busy} onClick={() => mutate(() => decidePharmacyOrder(pharmacyId, orderId, 'CONFIRM'))}>Confirm</button>
        <button type="button" className="pharmacy-danger-button" disabled={busy} onClick={() => mutate(() => decidePharmacyOrder(pharmacyId, orderId, 'REJECT'))}>Reject</button>
        <button type="button" className="pharmacy-secondary-button" disabled={busy} onClick={() => mutate(() => updatePharmacyOrderPreparation(pharmacyId, orderId, 'PREPARING'))}>Start preparing</button>
        <button type="button" className="pharmacy-secondary-button" disabled={busy} onClick={() => mutate(() => updatePharmacyOrderPreparation(pharmacyId, orderId, 'READY_FOR_PICKUP'))}>Ready for pickup</button>
        <button type="button" className="pharmacy-secondary-button" disabled={busy} onClick={() => mutate(() => completePharmacySelfPickup(pharmacyId, orderId))}>Complete pickup</button>
      </div><p>The backend remains authoritative and rejects actions that are invalid for the current state, role, or fulfilment method.</p></section>
      <section className="pharmacy-table-wrap"><table className="pharmacy-table"><thead><tr><th>Medicine</th><th>Prescription</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td><strong>{item.medicineNameSnapshot}</strong><small>{item.brandNameSnapshot || item.manufacturerSnapshot}</small></td><td>{item.requiresPrescription ? 'Required' : 'Not required'}</td><td>{item.quantity}</td><td>₹{item.unitPrice}</td><td>₹{item.lineTotal}</td></tr>)}</tbody></table></section>
      {order.prescriptions.length > 0 && <section className="pharmacy-card pharmacy-message"><strong>Prescription state</strong>{order.prescriptions.map((item) => <p key={item.id}>{labelFromEnum(item.status)} · uploaded {formatDate(item.uploadedAt)}</p>)}</section>}
    </>}
  </main>
}
