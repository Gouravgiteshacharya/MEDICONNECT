import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatAdminDate, labelFromEnum, listAdminPharmacies } from './adminService'

export default function AdminPharmacies() {
  const navigate = useNavigate()
  const [pharmacies, setPharmacies] = useState([])
  const [filters, setFilters] = useState({ isActive: '', isVerified: '', partnerStatus: '' })
  const [cursor, setCursor] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load(nextCursor = '', append = false) {
    setLoading(true); setError('')
    try {
      const payload = await listAdminPharmacies({ ...filters, cursor: nextCursor, limit: 20 })
      setPharmacies((current) => append ? [...current, ...payload.pharmacies] : payload.pharmacies)
      setCursor(payload.nextCursor || '')
    } catch (requestError) { setError(requestError?.message || 'Unable to load pharmacies.') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filters.isActive, filters.isVerified, filters.partnerStatus])

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>NETWORK</span><h1>Pharmacies</h1><p>Backend-authoritative partner status and verification records.</p></div></header>
    <section className="admin-form-panel"><div className="admin-form inline">
      <label><span>Active</span><select value={filters.isActive} onChange={(event) => setFilters({ ...filters, isActive: event.target.value })}><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select></label>
      <label><span>Verified</span><select value={filters.isVerified} onChange={(event) => setFilters({ ...filters, isVerified: event.target.value })}><option value="">All</option><option value="true">Verified</option><option value="false">Unverified</option></select></label>
      <label><span>Partner status</span><select value={filters.partnerStatus} onChange={(event) => setFilters({ ...filters, partnerStatus: event.target.value })}><option value="">All</option><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="SUSPENDED">Suspended</option></select></label>
    </div></section>
    {error && <div className="admin-feedback error">{error}</div>}
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pharmacy</th><th>Partner</th><th>Verified</th><th>Inventory mode</th><th>Updated</th><th></th></tr></thead><tbody>
      {pharmacies.map((pharmacy) => <tr key={pharmacy.id}><td><strong>{pharmacy.name}</strong><small>{pharmacy.id}</small></td><td>{labelFromEnum(pharmacy.partnerStatus)}</td><td>{pharmacy.isVerified ? 'Yes' : 'No'}</td><td>{labelFromEnum(pharmacy.inventoryManagementMode)}</td><td>{formatAdminDate(pharmacy.updatedAt)}</td><td><button className="admin-secondary-button" type="button" onClick={() => navigate(`/admin/pharmacies/${pharmacy.id}`)}>Open</button></td></tr>)}
      {!loading && pharmacies.length === 0 && <tr><td colSpan="6">No pharmacies match these filters.</td></tr>}
    </tbody></table></section>
    {loading && <div className="admin-feedback">Loading pharmacies...</div>}
    {cursor && !loading && <button className="admin-secondary-button" type="button" onClick={() => load(cursor, true)}>Load more</button>}
  </main>
}
