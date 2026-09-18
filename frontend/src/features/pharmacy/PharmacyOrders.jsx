import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatDate, labelFromEnum, listPharmacyOrders } from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyOrders() {
  const navigate = useNavigate()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()
  const [orders, setOrders] = useState([])
  const [status, setStatus] = useState('')
  const [fulfillmentMethod, setFulfillmentMethod] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(cursor) {
    setLoading(true)
    setError('')
    try {
      const result = await listPharmacyOrders(pharmacyId, {
        status,
        fulfillmentMethod,
        cursor,
      })
      setOrders((current) => cursor ? [...current, ...result.orders] : result.orders)
      setNextCursor(result.nextCursor)
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load pharmacy orders.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [pharmacyId, status, fulfillmentMethod])

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header"><div><span>ORDERS</span><h1>Order operations</h1><p>Real pharmacy-scoped orders, newest first.</p></div></header>
      <section className="pharmacy-toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Order status">
          <option value="">All statuses</option>
          {['CREATED', 'PRESCRIPTION_PENDING', 'PRESCRIPTION_APPROVED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED_BY_PHARMACY'].map((value) => <option key={value} value={value}>{labelFromEnum(value)}</option>)}
        </select>
        <select value={fulfillmentMethod} onChange={(event) => setFulfillmentMethod(event.target.value)} aria-label="Fulfilment method">
          <option value="">All fulfilment methods</option>
          <option value="DELIVERY">Delivery</option>
          <option value="SELF_PICKUP">Self pickup</option>
        </select>
      </section>
      {error && <div className="pharmacy-feedback error">{error}</div>}
      <section className="pharmacy-table-wrap">
        <table className="pharmacy-table"><thead><tr><th>Order</th><th>Status</th><th>Fulfilment</th><th>Items</th><th>Total</th><th>Placed</th><th /></tr></thead>
          <tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong><small>{order.id}</small></td><td><span className="pharmacy-badge">{labelFromEnum(order.status)}</span></td><td>{labelFromEnum(order.fulfillmentMethod)}</td><td>{order.itemCount}</td><td>₹{order.totalAmount}</td><td>{formatDate(order.placedAt)}</td><td><button type="button" className="pharmacy-secondary-button" onClick={() => navigate(pathWithPharmacy(`/pharmacy/orders/${order.id}`))}>Open</button></td></tr>)}</tbody>
        </table>
      </section>
      {!loading && orders.length === 0 && <div className="pharmacy-message">No orders match these filters.</div>}
      {nextCursor && <button type="button" className="pharmacy-secondary-button pharmacy-load-more" disabled={loading} onClick={() => load(nextCursor)}>{loading ? 'Loading...' : 'Load more'}</button>}
    </main>
  )
}
