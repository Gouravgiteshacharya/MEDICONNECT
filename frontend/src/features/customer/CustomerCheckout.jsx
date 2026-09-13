import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getCart } from '../commerce/cartService'
import { createPickupOrder } from '../commerce/orderService'

import './CustomerCheckout.css'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export default function CustomerCheckout() {
  const navigate = useNavigate()
  const { authenticated, initializing } = useAuth()

  const [cart, setCart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')

  const loadCart = useCallback(async () => {
    if (!authenticated) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await getCart()
      setCart(result?.cart ?? result ?? null)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load checkout information.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return

    if (!authenticated) {
      navigate('/app')
      return
    }

    loadCart()
  }, [authenticated, initializing, loadCart, navigate])

  async function placeOrder() {
    if (!cart) return

    setPlacing(true)
    setError('')

    try {
      const result = await createPickupOrder()
      const order = result?.order ?? result

      navigate(`/app/orders/${order.id}`, {
        replace: true,
      })
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to place your order. Please try again.',
      )
    } finally {
      setPlacing(false)
    }
  }

  if (initializing || loading) {
    return (
      <div className="customer-checkout-page">
        <main className="customer-checkout-main">
          <div className="customer-checkout-message">
            <strong>Preparing checkout...</strong>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="customer-checkout-page">
      <header className="customer-checkout-header">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/app/cart')}
        >
          <BackIcon />
        </button>

        <div>
          <small>CHECKOUT</small>
          <strong>Pickup order</strong>
        </div>
      </header>

      <main className="customer-checkout-main">
        {!cart ? (
          <section className="customer-checkout-empty">
            <h1>No active cart.</h1>

            <p>
              Search for a medicine and add it to your cart first.
            </p>

            <button
              type="button"
              onClick={() => navigate('/app/search')}
            >
              Search medicines
            </button>
          </section>
        ) : (
          <>
            <section className="customer-checkout-intro">
              <span>SELF PICKUP</span>

              <h1>Review your order.</h1>

              <p>
                Stock and price are checked again by MediConnect when the
                order is placed.
              </p>
            </section>

            <section className="customer-checkout-items">
              {cart.items.map((item) => (
                <article key={item.id}>
                  <div className="customer-checkout-item-mark">
                    {item.medicine.name?.charAt(0) || 'M'}
                  </div>

                  <div>
                    <div className="customer-checkout-item-title">
                      <strong>{item.medicine.name}</strong>

                      {item.medicine.requiresPrescription && (
                        <span>Rx</span>
                      )}
                    </div>

                    <p>
                      {item.medicine.genericName ||
                        item.medicine.brandName ||
                        item.medicine.manufacturer ||
                        'Medicine'}
                    </p>

                    <small>
                      Quantity · {item.quantity}
                    </small>
                  </div>
                </article>
              ))}
            </section>

            <section className="customer-checkout-pharmacy">
              <span>FULFILMENT</span>

              <div>
                <div className="customer-checkout-check">
                  <CheckIcon />
                </div>

                <div>
                  <strong>Pickup from pharmacy</strong>

                  <small>
                    Pharmacy ID · {cart.pharmacyId}
                  </small>
                </div>
              </div>
            </section>

            {cart.items.some(
              (item) => item.medicine.requiresPrescription,
            ) && (
              <section className="customer-checkout-rx">
                <div>Rx</div>

                <div>
                  <strong>Prescription required</strong>

                  <p>
                    This order will enter prescription review after it is
                    created. You’ll provide the prescription in the next step.
                  </p>
                </div>
              </section>
            )}

            <section className="customer-checkout-note">
              <strong>No payment is collected yet.</strong>

              <p>
                Payment integration is not part of the current Commerce
                backend, so this checkout only creates the MediConnect order.
              </p>
            </section>

            {error && (
              <div className="customer-checkout-error">
                {error}
              </div>
            )}

            <button
              className="customer-checkout-place"
              type="button"
              disabled={placing}
              onClick={placeOrder}
            >
              <span>
                <strong>
                  {placing
                    ? 'Placing order...'
                    : 'Place pickup order'}
                </strong>

                <small>
                  Final stock check happens now
                </small>
              </span>

              <span>→</span>
            </button>
          </>
        )}
      </main>
    </div>
  )
}
