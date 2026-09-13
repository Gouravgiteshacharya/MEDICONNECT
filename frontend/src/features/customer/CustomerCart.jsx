import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import {
  getCart,
  removeCartItem,
  setPickupFulfillment,
  updateCartItem,
} from '../commerce/cartService'

import CustomerAuthModal from './CustomerAuthModal'
import './CustomerCart.css'

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" />
    </svg>
  )
}

export default function CustomerCart() {
  const navigate = useNavigate()

  const {
    authenticated,
    initializing,
  } = useAuth()

  const [cart, setCart] = useState(null)

  const [loading, setLoading] = useState(true)
  const [busyItemId, setBusyItemId] = useState(null)
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false)

  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadCart = useCallback(async () => {
    if (!authenticated) {
      setCart(null)
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
          'Unable to load your cart.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return

    if (!authenticated) {
      setLoading(false)
      return
    }

    loadCart()
  }, [authenticated, initializing, loadCart])

  async function changeQuantity(item, nextQuantity) {
    if (nextQuantity < 1) return

    setBusyItemId(item.id)
    setError('')

    try {
      await updateCartItem(item.id, nextQuantity)
      await loadCart()
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update quantity.',
      )
    } finally {
      setBusyItemId(null)
    }
  }

  async function removeItem(itemId) {
    setBusyItemId(itemId)
    setError('')

    try {
      await removeCartItem(itemId)
      await loadCart()
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to remove this medicine.',
      )
    } finally {
      setBusyItemId(null)
    }
  }

  async function choosePickup() {
    setFulfillmentLoading(true)
    setError('')

    try {
      const result = await setPickupFulfillment()
      setCart(result?.cart ?? result)

      navigate('/app/checkout')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to select pickup.',
      )
    } finally {
      setFulfillmentLoading(false)
    }
  }

  const hasCartItems = Boolean(cart?.items?.length)

  if (initializing) {
    return (
      <div className="customer-cart-page">
        <main className="customer-cart-main">
          <div className="customer-cart-message">
            <strong>Loading your account...</strong>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="customer-cart-page">
      <header className="customer-cart-header">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <BackIcon />
        </button>

        <div>
          <small>YOUR CART</small>
          <strong>Medicines</strong>
        </div>
      </header>

      <main className="customer-cart-main">
        {!authenticated && (
          <section className="customer-cart-auth">
            <div className="customer-cart-lock">M</div>

            <h1>Sign in to view your cart.</h1>

            <p>
              Your MediConnect cart is linked to your customer account.
            </p>

            <button
              type="button"
              onClick={() => setAuthOpen(true)}
            >
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-cart-message">
            <strong>Loading your cart...</strong>
          </div>
        )}

        {authenticated && !loading && (!cart || !hasCartItems) && (
          <section className="customer-cart-empty">
            <div>+</div>

            <h1>Your cart is empty.</h1>

            <p>
              Search for a medicine and choose a nearby pharmacy to get started.
            </p>

            <button
              type="button"
              onClick={() => navigate('/app/search')}
            >
              Search medicines
            </button>
          </section>
        )}

        {authenticated && !loading && cart && hasCartItems && (
          <>
            <section className="customer-cart-summary">
              <span>PHARMACY CART</span>

              <h1>
                {cart.items.length}{' '}
                {cart.items.length === 1
                  ? 'medicine'
                  : 'medicines'}
              </h1>

              <p>
                All medicines in this cart come from the same pharmacy.
              </p>
            </section>

            <section className="customer-cart-items">
              {cart.items.map((item) => (
                <article
                  key={item.id}
                  className="customer-cart-item"
                >
                  <div className="customer-cart-item-mark">
                    {item.medicine.name?.charAt(0) || 'M'}
                  </div>

                  <div className="customer-cart-item-copy">
                    <div>
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

                    {item.medicine.manufacturer && (
                      <small>
                        {item.medicine.manufacturer}
                      </small>
                    )}
                  </div>

                  <button
                    type="button"
                    className="customer-cart-remove"
                    aria-label={`Remove ${item.medicine.name}`}
                    disabled={busyItemId === item.id}
                    onClick={() => removeItem(item.id)}
                  >
                    <TrashIcon />
                  </button>

                  <div className="customer-cart-quantity">
                    <button
                      type="button"
                      disabled={
                        busyItemId === item.id ||
                        item.quantity <= 1
                      }
                      onClick={() =>
                        changeQuantity(
                          item,
                          item.quantity - 1,
                        )
                      }
                    >
                      −
                    </button>

                    <strong>{item.quantity}</strong>

                    <button
                      type="button"
                      disabled={busyItemId === item.id}
                      onClick={() =>
                        changeQuantity(
                          item,
                          item.quantity + 1,
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                </article>
              ))}
            </section>

            <div className="customer-cart-note">
              <strong>Stock is checked again at checkout.</strong>

              <span>
                Quantities may change if pharmacy inventory changes before
                the order is placed.
              </span>
            </div>

            {cart.items.some(
              (item) => item.medicine.requiresPrescription,
            ) && (
              <div className="customer-cart-rx">
                <span>Rx</span>

                <div>
                  <strong>Prescription required</strong>

                  <p>
                    You’ll be able to provide the prescription as part of
                    the order flow.
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="customer-cart-error">
                {error}
              </div>
            )}

            <section className="customer-cart-fulfillment">
              <span>HOW DO YOU WANT IT?</span>

              <h2>Choose fulfilment</h2>

              <button
                type="button"
                className="customer-cart-fulfillment-option"
                disabled={fulfillmentLoading}
                onClick={choosePickup}
              >
                <div>
                  <strong>Pickup from pharmacy</strong>
                  <small>
                    Continue with self pickup
                  </small>
                </div>

                <span>→</span>
              </button>

              <button
                type="button"
                className="customer-cart-fulfillment-option"
                onClick={() =>
                  navigate('/app/delivery-address')
                }
              >
                <div>
                  <strong>Delivery</strong>
                  <small>
                    Choose address and get a delivery quote
                  </small>
                </div>

                <span>→</span>
              </button>
            </section>
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={loadCart}
      />
    </div>
  )
}
