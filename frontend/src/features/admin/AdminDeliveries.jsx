import { useState } from 'react'

import {
  evaluateDeliveryBatch,
  optimizeDeliveryBatch,
} from './adminService'

export default function AdminDeliveries() {
  const [batchOrderIds, setBatchOrderIds] = useState('')
  const [batchId, setBatchId] = useState('')
  const [result, setResult] = useState(null)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')

  async function evaluateBatch(event) {
    event.preventDefault()

    const orderIds = batchOrderIds
      .split(/\s|,/)
      .map((value) => value.trim())
      .filter(Boolean)

    setBusyAction('evaluate')
    setError('')
    setResult(null)

    try {
      setResult(await evaluateDeliveryBatch({ orderIds }))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to evaluate delivery batch.',
      )
    } finally {
      setBusyAction('')
    }
  }

  async function optimizeBatch(event) {
    event.preventDefault()

    setBusyAction('optimize')
    setError('')
    setResult(null)

    try {
      setResult(await optimizeDeliveryBatch(batchId.trim()))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to optimize this batch.',
      )
    } finally {
      setBusyAction('')
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>DELIVERY OPERATIONS</span>
          <h1>Batch and route actions</h1>
          <p>
            The backend exposes admin delivery action endpoints, but no
            cross-delivery monitoring list or detail endpoint yet.
          </p>
        </div>
      </header>

      <section className="admin-blocked">
        <strong>Delivery monitoring is blocked by backend API coverage.</strong>
        <p>
          Delivery assignments, batches, dispatch attempts, and events exist in
          the schema, but admin list/detail routes are not mounted.
        </p>
      </section>

      <form className="admin-form-panel" onSubmit={evaluateBatch}>
        <h2>Evaluate compatible batch</h2>
        <p>
          Submit comma- or line-separated order IDs for the real batch
          evaluation endpoint.
        </p>
        <div className="admin-form">
          <label>
            <span>Order IDs</span>
            <textarea
              required
              value={batchOrderIds}
              placeholder="Order UUIDs"
              onChange={(event) => setBatchOrderIds(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="admin-button"
            disabled={busyAction === 'evaluate'}
          >
            {busyAction === 'evaluate' ? 'Evaluating...' : 'Evaluate batch'}
          </button>
        </div>
      </form>

      <form className="admin-form-panel" onSubmit={optimizeBatch}>
        <h2>Optimize known batch route</h2>
        <div className="admin-form inline">
          <label>
            <span>Batch ID</span>
            <input
              required
              value={batchId}
              placeholder="Delivery batch UUID"
              autoComplete="off"
              onChange={(event) => setBatchId(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="admin-button"
            disabled={busyAction === 'optimize'}
          >
            {busyAction === 'optimize' ? 'Optimizing...' : 'Optimize'}
          </button>
        </div>
      </form>

      {error && <div className="admin-feedback error">{error}</div>}

      {result && (
        <section className="admin-result">
          <strong>Delivery operation result</strong>
          <pre className="admin-pre">{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </main>
  )
}
