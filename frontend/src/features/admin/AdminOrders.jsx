import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatAdminDate, labelFromEnum, listAdminOrders } from './adminService'

export default function AdminOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [filters, setFilters] = useState({ status: '', fulfillmentMethod: '', requiresPrescription: '' })
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(nextCursor = '', append = false) {
    setLoading(true); setError('')
    try {
      const payload = await listAdminOrders({ ...filters, cursor: nextCursor, limit: 20 })
      setOrders((current) => append ? [...current, ...payload.orders] : payload.orders)
      setCursor(payload.nextCursor || '')
    } catch (requestError) { setError(requestError?.message || 'Unable to load orders.') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filters.status, filters.fulfillmentMethod, filters.requiresPrescription])

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>ORDER OPERATIONS</span><h1>Orders</h1><p>Monitor fulfillment and open a backend-authoritative order detail.</p></div></header>
    <section className="admin-form-panel"><div className="admin-form inline">
      <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All</option>{['CREATED', 'PRESCRIPTION_PENDING', 'PRESCRIPTION_APPROVED', 'PRESCRIPTION_REJECTED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'PICKED_UP_BY_CUSTOMER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED_BY_PHARMACY'].map((value) => <option key={value} value={value}>{labelFromEnum(value)}</option>)}</select></label>
      <label><span>Fulfillment</span><select value={filters.fulfillmentMethod} onChange={(event) => setFilters({ ...filters, fulfillmentMethod: event.target.value })}><option value="">All</option><option value="SELF_PICKUP">Self pickup</option><option value="DELIVERY">Delivery</option></select></label>
      <label><span>Prescription</span><select value={filters.requiresPrescription} onChange={(event) => setFilters({ ...filters, requiresPrescription: event.target.value })}><option value="">All</option><option value="true">Required</option><option value="false">Not required</option></select></label>
    </div></section>
    {error && <div className="admin-feedback error">{error}</div>}
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Pharmacy</th><th>Status</th><th>Fulfillment</th><th>Total</th><th>Created</th><th></th></tr></thead><tbody>
      {orders.map((order) => <tr key={order.id}><td><strong>{order.orderNumber || order.id}</strong><small>{order.id}</small></td><td>{order.pharmacy?.name}</td><td>{labelFromEnum(order.status)}</td><td>{labelFromEnum(order.fulfillmentMethod)}</td><td>₹{order.totalAmount}</td><td>{formatAdminDate(order.placedAt)}</td><td><button className="admin-secondary-button" type="button" onClick={() => navigate(`/admin/orders/${order.id}`)}>Open</button></td></tr>)}
      {!loading && orders.length === 0 && <tr><td colSpan="7">No orders match these filters.</td></tr>}
    </tbody></table></section>
    {loading && <div className="admin-feedback">Loading orders...</div>}
    {cursor && !loading && <button className="admin-secondary-button" type="button" onClick={() => load(cursor, true)}>Load more</button>}
  </main>
}
