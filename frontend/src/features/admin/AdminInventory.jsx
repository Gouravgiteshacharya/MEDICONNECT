import { useEffect, useState } from 'react'

import { formatAdminDate, labelFromEnum, listAdminInventory } from './adminService'

export default function AdminInventory() {
  const [inventory, setInventory] = useState([])
  const [filters, setFilters] = useState({ availability: '', freshness: '' })
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(nextCursor = '', append = false) {
    setLoading(true); setError('')
    try {
      const payload = await listAdminInventory({ ...filters, cursor: nextCursor, limit: 20 })
      setInventory((current) => append ? [...current, ...payload.inventory] : payload.inventory)
      setCursor(payload.nextCursor || '')
    } catch (requestError) { setError(requestError?.message || 'Unable to load inventory.') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filters.availability, filters.freshness])

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>NETWORK INVENTORY</span><h1>Inventory</h1><p>Live stock, price, availability, and freshness across pharmacies.</p></div></header>
    <section className="admin-form-panel"><div className="admin-form inline">
      <label><span>Availability</span><select value={filters.availability} onChange={(event) => setFilters({ ...filters, availability: event.target.value })}><option value="">All</option><option value="IN_STOCK">In stock</option><option value="LOW_STOCK">Low stock</option><option value="OUT_OF_STOCK">Out of stock</option></select></label>
      <label><span>Freshness</span><select value={filters.freshness} onChange={(event) => setFilters({ ...filters, freshness: event.target.value })}><option value="">All</option><option value="FRESH">Fresh</option><option value="STALE">Stale</option></select></label>
    </div></section>
    {error && <div className="admin-feedback error">{error}</div>}
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Medicine</th><th>Pharmacy</th><th>Quantity</th><th>Price</th><th>Availability</th><th>Freshness</th><th>Updated</th></tr></thead><tbody>
      {inventory.map((item) => <tr key={item.id}><td><strong>{item.medicine?.name}</strong><small>{item.medicine?.strength || item.medicineId}</small></td><td>{item.pharmacy?.name}</td><td>{item.quantity}</td><td>₹{item.sellingPrice}</td><td>{labelFromEnum(item.availability)}</td><td>{labelFromEnum(item.freshness)}</td><td>{formatAdminDate(item.updatedAt)}</td></tr>)}
      {!loading && inventory.length === 0 && <tr><td colSpan="7">No inventory records match these filters.</td></tr>}
    </tbody></table></section>
    {loading && <div className="admin-feedback">Loading inventory...</div>}
    {cursor && !loading && <button className="admin-secondary-button" type="button" onClick={() => load(cursor, true)}>Load more</button>}
  </main>
}
