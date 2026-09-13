import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  decidePharmacyOrder,
  labelFromEnum,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyOrderAction() {
  const navigate = useNavigate()
  const { orderId } = useParams()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()

  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function decide(decision) {
    setBusy(true)
    setError('')

    try {
      setResult(await decidePharmacyOrder(pharmacyId, orderId, decision))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update this order.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>ORDER DECISION</span>
          <h1>Known order action</h1>
          <p>
            Pharmacy order details are not currently exposed. This page only
            calls the supported confirm/reject decision endpoint.
          </p>
        </div>

        <button
          type="button"
          className="pharmacy-secondary-button"
          onClick={() => navigate(pathWithPharmacy('/pharmacy/orders'))}
        >
          Back
        </button>
      </header>

      <section className="pharmacy-card pharmacy-message">
        <strong>{orderId}</strong>
        <p>
          Confirm is allowed by the backend for created non-Rx orders or
          prescription-approved Rx orders. Reject is allowed for the same
          decision-ready states.
        </p>
        <div className="pharmacy-row-actions">
          <button
            type="button"
            className="pharmacy-button"
            disabled={busy}
            onClick={() => decide('CONFIRM')}
          >
            Confirm order
          </button>
          <button
            type="button"
            className="pharmacy-danger-button"
            disabled={busy}
            onClick={() => decide('REJECT')}
          >
            Reject order
          </button>
        </div>
      </section>

      {error && <div className="pharmacy-feedback error">{error}</div>}

      {result && (
        <section className="pharmacy-card pharmacy-message">
          <strong>{result.orderNumber}</strong>
          <p>Status: {labelFromEnum(result.status)}</p>
          <p>Total: Rs {result.totalAmount}</p>
        </section>
      )}
    </main>
  )
}
