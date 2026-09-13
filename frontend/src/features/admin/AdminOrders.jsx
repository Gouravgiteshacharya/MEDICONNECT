import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { dispatchOrder } from './adminService'

export default function AdminOrders() {
  const navigate = useNavigate()
  const [orderId, setOrderId] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submitDispatch(event) {
    event.preventDefault()

    setBusy(true)
    setError('')
    setResult(null)

    try {
      setResult(await dispatchOrder(orderId.trim()))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to dispatch this order.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>ORDER OPERATIONS</span>
          <h1>Dispatch known order</h1>
          <p>
            The backend supports dispatch action for a known order ID. It does
            not expose an admin order list or order detail endpoint yet.
          </p>
        </div>
      </header>

      <section className="admin-blocked">
        <strong>Order queue is blocked by backend API coverage.</strong>
        <p>
          Add admin order list/detail APIs before showing a real monitoring
          table or operational order timeline here.
        </p>
      </section>

      <form className="admin-form-panel" onSubmit={submitDispatch}>
        <h2>Trigger dispatch</h2>
        <p>
          This calls the real admin endpoint and returns the backend dispatch
          result.
        </p>
        <div className="admin-form inline">
          <label>
            <span>Order ID</span>
            <input
              required
              value={orderId}
              placeholder="Order UUID"
              autoComplete="off"
              onChange={(event) => setOrderId(event.target.value)}
            />
          </label>
          <div className="admin-form-actions">
            <button type="submit" className="admin-button" disabled={busy}>
              {busy ? 'Dispatching...' : 'Dispatch'}
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={!orderId.trim()}
              onClick={() => navigate(`/admin/orders/${orderId.trim()}`)}
            >
              Open detail
            </button>
          </div>
        </div>
      </form>

      {error && <div className="admin-feedback error">{error}</div>}

      {result && (
        <section className="admin-result">
          <strong>Dispatch result</strong>
          <pre className="admin-pre">{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </main>
  )
}
