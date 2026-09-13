import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  getPharmacyDashboard,
  labelFromEnum,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyDashboard() {
  const navigate = useNavigate()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()

  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      setDashboard(await getPharmacyDashboard(pharmacyId))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load pharmacy dashboard.',
      )
    } finally {
      setLoading(false)
    }
  }, [pharmacyId])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const pharmacy = dashboard?.pharmacy
  const summary = dashboard?.inventorySummary
  const availability = summary?.byAvailability ?? {}
  const staleCount = summary?.freshness?.stale ?? 0

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>PHARMACY DASHBOARD</span>
          <h1>{pharmacy?.name ?? 'Operational workspace'}</h1>
          <p>
            Inventory summary and account state are loaded from the pharmacy
            backend for this workspace.
          </p>
        </div>

        <button
          type="button"
          className="pharmacy-secondary-button"
          onClick={loadDashboard}
        >
          Refresh
        </button>
      </header>

      {loading && (
        <div className="pharmacy-message">
          <strong>Loading dashboard...</strong>
        </div>
      )}

      {!loading && error && (
        <section className="pharmacy-message">
          <strong>Dashboard could not load</strong>
          <span>{error}</span>
          <button
            type="button"
            className="pharmacy-button"
            onClick={loadDashboard}
          >
            Try again
          </button>
        </section>
      )}

      {!loading && !error && dashboard && (
        <>
          <section className="pharmacy-grid pharmacy-metrics">
            <article className="pharmacy-card pharmacy-metric">
              <small>INVENTORY RECORDS</small>
              <strong>{summary.totalRecords}</strong>
              <p>{summary.totalUnits} recorded units</p>
            </article>

            <article className="pharmacy-card pharmacy-metric">
              <small>LOW STOCK</small>
              <strong>{availability.LOW_STOCK ?? 0}</strong>
              <p>Items currently marked low stock</p>
            </article>

            <article className="pharmacy-card pharmacy-metric">
              <small>STALE INVENTORY</small>
              <strong>{staleCount}</strong>
              <p>Records past the freshness threshold</p>
            </article>

            <article className="pharmacy-card pharmacy-metric">
              <small>RX CATALOGUE</small>
              <strong>
                {summary.prescriptionRequirement.requiresPrescription}
              </strong>
              <p>Inventory records requiring prescription</p>
            </article>
          </section>

          <section className="pharmacy-grid pharmacy-split">
            <article className="pharmacy-card">
              <div className="pharmacy-section-head">
                <div>
                  <span>AVAILABILITY</span>
                  <h2>Inventory states</h2>
                </div>
                <button
                  type="button"
                  className="pharmacy-secondary-button"
                  onClick={() => navigate(pathWithPharmacy('/pharmacy/inventory'))}
                >
                  Open inventory
                </button>
              </div>

              <div className="pharmacy-status-grid">
                {Object.entries(availability).map(([status, count]) => (
                  <div className="pharmacy-status-row" key={status}>
                    <span>{labelFromEnum(status)}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="pharmacy-card">
              <div className="pharmacy-section-head">
                <div>
                  <span>PHARMACY STATE</span>
                  <h2>Operational profile</h2>
                </div>
                <button
                  type="button"
                  className="pharmacy-secondary-button"
                  onClick={() => navigate(pathWithPharmacy('/pharmacy/profile'))}
                >
                  Profile
                </button>
              </div>

              <div className="pharmacy-status-grid">
                <div className="pharmacy-status-row">
                  <span>Partner status</span>
                  <strong>{labelFromEnum(pharmacy.partnerStatus)}</strong>
                </div>
                <div className="pharmacy-status-row">
                  <span>Active</span>
                  <strong>{pharmacy.isActive ? 'Yes' : 'No'}</strong>
                </div>
                <div className="pharmacy-status-row">
                  <span>Verification</span>
                  <strong>{pharmacy.isVerified ? 'Verified' : 'Not verified'}</strong>
                </div>
                <div className="pharmacy-status-row">
                  <span>Inventory mode</span>
                  <strong>{labelFromEnum(pharmacy.inventoryManagementMode)}</strong>
                </div>
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  )
}
