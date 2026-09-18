import { useEffect, useState } from 'react'

import { getAdminOperationsSummary } from './adminService'

const metrics = [
  ['activePharmacies', 'Active pharmacies'],
  ['openOrders', 'Open orders'],
  ['pendingPrescriptionReviews', 'Pending prescription reviews'],
  ['staleInventory', 'Stale inventory records'],
  ['activeDeliveries', 'Active deliveries'],
]

export default function AdminOverview() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAdminOperationsSummary()
      .then((payload) => active && setSummary(payload.summary))
      .catch((requestError) =>
        active && setError(requestError?.message || 'Unable to load operations summary.'),
      )
    return () => { active = false }
  }, [])

  return <main className="admin-page">
    <header className="admin-page-header"><div><span>MEDICONNECT OPERATIONS</span><h1>Admin overview</h1><p>Live operational counts reported by the backend.</p></div></header>
    {error && <div className="admin-feedback error">{error}</div>}
    {!summary && !error && <div className="admin-feedback">Loading summary...</div>}
    {summary && <section className="admin-grid admin-metrics">{metrics.map(([key, label]) => <article className="admin-card" key={key}><small>{label.toUpperCase()}</small><strong>{summary[key]}</strong></article>)}</section>}
  </main>
}
