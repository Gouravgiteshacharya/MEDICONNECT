import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getOrder, getOrders } from '../commerce/orderService'
import CustomerAuthModal from './CustomerAuthModal'
import './CustomerPrescriptions.css'

function formatDate(value) {
  if (!value) return 'Not available'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function statusLabel(status) {
  if (!status) return 'Not available'

  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function hasRxItem(order) {
  return order.items?.some((item) => item.requiresPrescription)
}

function prescriptionState(order) {
  if (order.status === 'PRESCRIPTION_PENDING') return 'Action may be needed'
  if (order.status === 'PRESCRIPTION_REJECTED') return 'Rejected'
  if (order.status === 'PRESCRIPTION_APPROVED') return 'Approved'
  return statusLabel(order.status)
}

export default function CustomerPrescriptions() {
  const navigate = useNavigate()
  const { authenticated, initializing } = useAuth()

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadPrescriptions = useCallback(async () => {
    if (!authenticated) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await getOrders({ limit: 20 })
      const detailResults = await Promise.allSettled(
        (result.orders ?? []).map((order) => getOrder(order.id)),
      )

      const rxOrders = detailResults
        .filter((item) => item.status === 'fulfilled')
        .map((item) => item.value?.order ?? item.value)
        .filter((order) => order && hasRxItem(order))

      setOrders(rxOrders)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load prescription orders.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return
    loadPrescriptions()
  }, [initializing, loadPrescriptions])

  return (
    <div className="customer-prescriptions-page">
      <header className="customer-prescriptions-header">
        <div>
          <small>PRESCRIPTIONS</small>
          <strong>Order review</strong>
        </div>

        <button type="button" onClick={() => navigate('/app/orders')}>
          Orders
        </button>
      </header>

      <main className="customer-prescriptions-main">
        {!authenticated && !initializing && (
          <section className="customer-prescriptions-auth">
            <div>Rx</div>
            <h1>Sign in to view prescriptions.</h1>
            <p>Prescription records are attached to your MediConnect orders.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-prescriptions-message">
            <strong>Loading prescription orders...</strong>
          </div>
        )}

        {authenticated && !loading && error && (
          <section className="customer-prescriptions-message">
            <strong>Prescriptions could not load</strong>
            <span>{error}</span>
            <button type="button" onClick={loadPrescriptions}>
              Try again
            </button>
          </section>
        )}

        {authenticated && !loading && !error && orders.length === 0 && (
          <section className="customer-prescriptions-empty">
            <div>Rx</div>
            <h1>No prescription orders yet.</h1>
            <p>
              When an order contains Rx medicines, its prescription review
              state appears here.
            </p>
            <button type="button" onClick={() => navigate('/app/search')}>
              Search medicines
            </button>
          </section>
        )}

        {authenticated && !loading && !error && orders.length > 0 && (
          <>
            <section className="customer-prescriptions-summary">
              <span>ORDER ATTACHED</span>
              <h1>{orders.length} prescription orders</h1>
              <p>
                Uploads use the storage-neutral metadata currently supported by
                the backend. MediConnect does not provide medical advice.
              </p>
            </section>

            <section className="customer-prescriptions-list">
              {orders.map((order) => {
                const latestPrescription = order.prescriptions?.at(-1)
                const needsUpload =
                  order.status === 'PRESCRIPTION_PENDING' &&
                  !latestPrescription

                return (
                  <button
                    key={order.id}
                    type="button"
                    className="customer-prescription-card"
                    onClick={() => navigate(`/app/prescriptions/${order.id}`)}
                  >
                    <div className="customer-prescription-mark">Rx</div>

                    <div>
                      <div>
                        <strong>{order.orderNumber}</strong>
                        <span>{prescriptionState(order)}</span>
                      </div>

                      <p>
                        {order.items.filter((item) => item.requiresPrescription)
                          .length}{' '}
                        Rx item
                        {order.items.filter((item) => item.requiresPrescription)
                          .length === 1
                          ? ''
                          : 's'}
                      </p>

                      <small>
                        {latestPrescription
                          ? `Latest upload ${formatDate(latestPrescription.uploadedAt)}`
                          : needsUpload
                            ? 'Prescription metadata is needed for review'
                            : `Placed ${formatDate(order.placedAt)}`}
                      </small>
                    </div>

                    <span>→</span>
                  </button>
                )
              })}
            </section>
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={loadPrescriptions}
      />
    </div>
  )
}
