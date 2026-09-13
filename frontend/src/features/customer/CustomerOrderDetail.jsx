import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getOrder } from '../commerce/orderService'
import CustomerAuthModal from './CustomerAuthModal'
import './CustomerOrderDetail.css'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function formatDate(value) {
  if (!value) return 'Not set'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Rs --'
  return `Rs ${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`
}

function statusLabel(status) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function deliveryAddress(order) {
  const line2 = order.deliveryAddressLine2Snapshot
    ? `, ${order.deliveryAddressLine2Snapshot}`
    : ''
  const landmark = order.deliveryLandmarkSnapshot
    ? ` · ${order.deliveryLandmarkSnapshot}`
    : ''

  if (!order.deliveryAddressLine1Snapshot) return null

  return `${order.deliveryAddressLine1Snapshot}${line2}, ${order.deliveryCitySnapshot}, ${order.deliveryStateSnapshot} ${order.deliveryPostalCodeSnapshot}${landmark}`
}

export default function CustomerOrderDetail() {
  const navigate = useNavigate()
  const { orderId } = useParams()
  const { authenticated, initializing } = useAuth()

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadOrder = useCallback(async () => {
    if (!authenticated || !orderId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await getOrder(orderId)
      setOrder(result?.order ?? result)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load this order.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated, orderId])

  useEffect(() => {
    if (initializing) return
    loadOrder()
  }, [initializing, loadOrder])

  return (
    <div className="customer-order-detail-page">
      <header className="customer-order-detail-header">
        <button
          type="button"
          aria-label="Back to orders"
          onClick={() => navigate('/app/orders')}
        >
          <BackIcon />
        </button>

        <div>
          <small>ORDER DETAIL</small>
          <strong>{order?.orderNumber ?? 'MediConnect order'}</strong>
        </div>
      </header>

      <main className="customer-order-detail-main">
        {!authenticated && !initializing && (
          <section className="customer-order-detail-auth">
            <div>M</div>
            <h1>Sign in to view this order.</h1>
            <p>Order details are available only to the customer account.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-order-detail-message">
            <strong>Loading order...</strong>
          </div>
        )}

        {authenticated && !loading && error && (
          <section className="customer-order-detail-message">
            <strong>Order could not load</strong>
            <span>{error}</span>
            <button type="button" onClick={loadOrder}>
              Try again
            </button>
          </section>
        )}

        {authenticated && !loading && !error && order && (
          <>
            <section className="customer-order-detail-hero">
              <span>{order.fulfillmentMethod === 'DELIVERY' ? 'DELIVERY' : 'SELF PICKUP'}</span>
              <h1>{statusLabel(order.status)}</h1>
              <p>
                Placed {formatDate(order.placedAt)} · Pharmacy ID {order.pharmacyId}
              </p>
            </section>

            <section className="customer-order-detail-grid">
              <article>
                <small>Medicine subtotal</small>
                <strong>{formatMoney(order.medicineSubtotal)}</strong>
              </article>

              <article>
                <small>Delivery fee</small>
                <strong>{formatMoney(order.deliveryFee)}</strong>
              </article>

              <article>
                <small>Total</small>
                <strong>{formatMoney(order.totalAmount)}</strong>
              </article>
            </section>

            <section className="customer-order-detail-section">
              <div className="customer-order-detail-section-head">
                <span>ITEMS</span>
                <strong>{order.items.length}</strong>
              </div>

              <div className="customer-order-detail-items">
                {order.items.map((item) => (
                  <article key={item.id}>
                    <div className="customer-order-detail-item-mark">
                      {item.medicineNameSnapshot?.charAt(0) || 'M'}
                    </div>

                    <div>
                      <div className="customer-order-detail-item-title">
                        <strong>{item.medicineNameSnapshot}</strong>
                        {item.requiresPrescription && <span>Rx</span>}
                      </div>

                      <p>
                        {item.brandNameSnapshot ||
                          item.manufacturerSnapshot ||
                          'Medicine'}
                      </p>

                      <small>
                        Qty {item.quantity} · {formatMoney(item.unitPrice)} each
                      </small>
                    </div>

                    <b>{formatMoney(item.lineTotal)}</b>
                  </article>
                ))}
              </div>
            </section>

            <section className="customer-order-detail-section">
              <div className="customer-order-detail-section-head">
                <span>FULFILMENT</span>
                <strong>
                  {order.fulfillmentMethod === 'DELIVERY'
                    ? 'Delivery'
                    : 'Self pickup'}
                </strong>
              </div>

              {order.fulfillmentMethod === 'DELIVERY' ? (
                <p className="customer-order-detail-copy">
                  {deliveryAddress(order) || 'Delivery address snapshot unavailable.'}
                </p>
              ) : (
                <p className="customer-order-detail-copy">
                  Collect this order from the selected pharmacy after pharmacy confirmation.
                </p>
              )}
            </section>

            {order.prescriptions?.length > 0 && (
              <section className="customer-order-detail-section">
                <div className="customer-order-detail-section-head">
                  <span>PRESCRIPTIONS</span>
                  <strong>{order.prescriptions.length}</strong>
                </div>

                <div className="customer-order-detail-prescriptions">
                  {order.prescriptions.map((prescription) => (
                    <article key={prescription.id}>
                      <strong>{statusLabel(prescription.status)}</strong>
                      <span>{prescription.originalFilename}</span>
                      <small>
                        Uploaded {formatDate(prescription.uploadedAt)}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={loadOrder}
      />
    </div>
  )
}
