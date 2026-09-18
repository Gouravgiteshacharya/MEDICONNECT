import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { formatAdminDate, getAdminPharmacy, labelFromEnum } from './adminService'

export default function AdminPharmacyDetail() {
  const { pharmacyId } = useParams()
  const [pharmacy, setPharmacy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { getAdminPharmacy(pharmacyId).then((payload) => setPharmacy(payload.pharmacy)).catch((requestError) => setError(requestError?.message || 'Unable to load pharmacy.')) }, [pharmacyId])

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>PHARMACY DETAIL</span><h1>{pharmacy?.name || 'Pharmacy'}</h1><p>{pharmacyId}</p></div></header>
    {error && <div className="admin-feedback error">{error}</div>}
    {!pharmacy && !error && <div className="admin-feedback">Loading pharmacy...</div>}
    {pharmacy && <section className="admin-grid admin-metrics">
      <article className="admin-card"><small>PARTNER STATUS</small><strong>{labelFromEnum(pharmacy.partnerStatus)}</strong><p>{pharmacy.isActive ? 'Active' : 'Inactive'}</p></article>
      <article className="admin-card"><small>VERIFICATION</small><strong>{pharmacy.isVerified ? 'Verified' : 'Unverified'}</strong><p>Backend verification state</p></article>
      <article className="admin-card"><small>INVENTORY MODE</small><strong>{labelFromEnum(pharmacy.inventoryManagementMode)}</strong><p>Updated {formatAdminDate(pharmacy.updatedAt)}</p></article>
    </section>}
    {pharmacy && <section className="admin-form-panel"><h2>Contact and address</h2><p>{pharmacy.phone || 'No phone'} · {pharmacy.email || 'No email'}</p><p>{[pharmacy.addressLine1, pharmacy.addressLine2, pharmacy.city, pharmacy.state, pharmacy.postalCode].filter(Boolean).join(', ') || 'No address supplied'}</p></section>}
  </main>
}
