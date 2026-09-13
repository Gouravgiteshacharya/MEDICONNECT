import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getOrders } from '../commerce/orderService'
import CustomerAuthModal from './CustomerAuthModal'
import './CustomerOrders.css'

function formatDate(value) {
  if (!value) return 'Date unavailable'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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

export default function CustomerOrders() {
  const navigate = useNavigate()
  const { authenticated, initializing } = useAuth()

  const [orders, setOrders] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadOrders = useCallback(async ({ cursor } = {}) => {
    if (!authenticated) {
      setLoading(false)
      return
    }

    if (cursor) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }

    setError('')

    try {
      const result = await getOrders({
        limit: 12,
        cursor,
      })

      setOrders((current) => (
        cursor
          ? [...current, ...(result.orders ?? [])]
          : result.orders ?? []
      ))
      setNextCursor(result.nextCursor ?? null)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load your orders.',
      )
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return
    loadOrders()
  }, [initializing, loadOrders])

  return (
    <div className="customer-orders-page">
      <header className="customer-orders-header">
        <div>
          <small>YOUR ORDERS</small>
          <strong>Order history</strong>
        </div>

        <button type="button" onClick={() => navigate('/app/search')}>
          Search
        </button>
      </header>

      <main className="customer-orders-main">
        {!authenticated && !initializing && (
          <section className="customer-orders-auth">
            <div>M</div>
            <h1>Sign in to see your orders.</h1>
            <p>Your order history is linked to your MediConnect account.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-orders-message">
            <strong>Loading orders...</strong>
          </div>
        )}

        {authenticated && !loading && error && (
          <section className="customer-orders-message">
            <strong>Orders could not load</strong>
            <span>{error}</span>
            <button type="button" onClick={() => loadOrders()}>
              Try again
            </button>
          </section>
        )}

        {authenticated && !loading && !error && orders.length === 0 && (
          <section className="customer-orders-empty">
            <div>+</div>
            <h1>No orders yet.</h1>
            <p>Search for a medicine and choose a nearby pharmacy first.</p>
            <button type="button" onClick={() => navigate('/app/search')}>
              Search medicines
            </button>
          </section>
        )}

        {authenticated && !loading && !error && orders.length > 0 && (
          <>
            <section className="customer-orders-summary">
              <span>ACTIVE ACCOUNT</span>
              <h1>{orders.length} recent orders</h1>
              <p>Open an order to see its items, fulfilment and review state.</p>
            </section>

            <section className="customer-orders-list">
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  className="customer-order-card"
                  onClick={() => navigate(`/app/orders/${order.id}`)}
                >
                  <div className="customer-order-mark">
                    {order.fulfillmentMethod === 'DELIVERY' ? 'D' : 'P'}
                  </div>

                  <div className="customer-order-copy">
                    <div>
                      <strong>{order.orderNumber}</strong>
                      <span>{statusLabel(order.status)}</span>
                    </div>

                    <p>
                      {order.itemCount}{' '}
                      {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
                      {order.fulfillmentMethod === 'DELIVERY'
                        ? 'Delivery'
                        : 'Self pickup'}
                    </p>

                    <small>{formatDate(order.placedAt)}</small>
                  </div>

                  <div className="customer-order-total">
                    <strong>{formatMoney(order.totalAmount)}</strong>
                    <span>View</span>
                  </div>
                </button>
              ))}
            </section>

            {nextCursor && (
              <button
                className="customer-orders-load"
                type="button"
                disabled={loadingMore}
                onClick={() => loadOrders({ cursor: nextCursor })}
              >
                {loadingMore ? 'Loading...' : 'Load more orders'}
              </button>
            )}
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => loadOrders()}
      />
    </div>
  )
}
