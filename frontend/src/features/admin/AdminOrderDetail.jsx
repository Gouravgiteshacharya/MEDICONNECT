import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { dispatchOrder, formatAdminDate, getAdminOrder, labelFromEnum } from './adminService'

export default function AdminOrderDetail() {
  const { orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    try { const payload = await getAdminOrder(orderId); setOrder(payload.order) }
    catch (requestError) { setError(requestError?.message || 'Unable to load order.') }
  }

  useEffect(() => { load() }, [orderId])

  async function handleDispatch() {
    setBusy(true); setError(''); setMessage('')
    try { await dispatchOrder(orderId); setMessage('Dispatch created successfully.'); await load() }
    catch (requestError) { setError(requestError?.message || 'Unable to dispatch order.') }
    finally { setBusy(false) }
  }

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>ORDER DETAIL</span><h1>{order?.orderNumber || 'Order'}</h1><p>{orderId}</p></div>{order?.fulfillmentMethod === 'DELIVERY' && <button type="button" className="admin-button" disabled={busy} onClick={handleDispatch}>{busy ? 'Dispatching...' : 'Dispatch order'}</button>}</header>
    {error && <div className="admin-feedback error">{error}</div>}{message && <div className="admin-feedback">{message}</div>}
    {!order && !error && <div className="admin-feedback">Loading order...</div>}
    {order && <>
      <section className="admin-grid admin-metrics">
        <article className="admin-card"><small>STATUS</small><strong>{labelFromEnum(order.status)}</strong><p>{labelFromEnum(order.fulfillmentMethod)}</p></article>
        <article className="admin-card"><small>CUSTOMER</small><strong>{order.customer?.name || 'Customer'}</strong><p>{order.customer?.email || order.customer?.phone || 'No contact returned'}</p></article>
        <article className="admin-card"><small>PHARMACY</small><strong>{order.pharmacy?.name}</strong><p>{order.pharmacy?.id}</p></article>
        <article className="admin-card"><small>TOTAL</small><strong>₹{order.totalAmount}</strong><p>Created {formatAdminDate(order.createdAt)}</p></article>
      </section>
      <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Medicine</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{order.items?.map((item) => <tr key={item.id}><td><strong>{item.medicineNameSnapshot}</strong><small>{item.brandNameSnapshot || item.manufacturerSnapshot}</small></td><td>{item.quantity}</td><td>₹{item.unitPrice}</td><td>₹{item.lineTotal}</td></tr>)}</tbody></table></section>
      {order.prescriptions?.length > 0 && <section className="admin-form-panel"><h2>Prescriptions</h2>{order.prescriptions.map((prescription) => <p key={prescription.id}><strong>{labelFromEnum(prescription.status)}</strong> · {prescription.id}</p>)}</section>}
    </>}
  </main>
}
