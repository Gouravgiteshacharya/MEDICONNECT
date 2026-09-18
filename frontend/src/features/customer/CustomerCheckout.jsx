import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getCart } from '../commerce/cartService'
import {
  createDeliveryOrder,
  createPickupOrder,
} from '../commerce/orderService'

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
  const [searchParams] = useSearchParams()
  const { authenticated, initializing } = useAuth()

  const [cart, setCart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')
  const deliveryQuoteId = searchParams.get('deliveryQuoteId')
  const missingDeliveryQuote =
    cart?.fulfillmentMethod === 'DELIVERY' && !deliveryQuoteId

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

    if (missingDeliveryQuote) {
      setError('Choose a delivery address and quote before placing this order.')
      return
    }

    setPlacing(true)
    setError('')

    try {
      const result = cart.fulfillmentMethod === 'DELIVERY'
        ? await createDeliveryOrder(deliveryQuoteId)
        : await createPickupOrder()
      const order = result?.order ?? result
      const requiresPrescription = order.items?.some(
        (item) => item.requiresPrescription,
      )
      const destination = requiresPrescription
        ? `/app/orders/${order.id}/prescription`
        : `/app/orders/${order.id}`

      navigate(destination, {
        replace: true,
      })
    } catch (requestError) {
      const integrityMessages = {
        CHECKOUT_QUANTITY_UNAVAILABLE: 'A medicine no longer has enough stock. Your cart has been refreshed.',
        CHECKOUT_ITEM_NOT_ORDERABLE: 'A medicine is no longer available at this pharmacy. Your cart has been refreshed.',
        CART_STATE_CONFLICT: 'Your cart changed before checkout. Review the refreshed cart before trying again.',
        CART_FULFILLMENT_CONFLICT: 'The fulfilment selection changed. Review the refreshed cart before trying again.',
        CHECKOUT_CONFLICT: 'Stock or checkout state changed. Review the refreshed cart before trying again.',
        DELIVERY_QUOTE_EXPIRED: 'Your delivery quote expired. Choose the delivery address again for a fresh quote.',
        DELIVERY_QUOTE_INVALID: 'The delivery quote is no longer valid. Choose the delivery address again.',
        DELIVERY_QUOTE_ALREADY_USED: 'This delivery quote was already used. Choose the delivery address again.',
      }
      setError(integrityMessages[requestError?.code] || requestError?.message || 'Unable to place your order. Please try again.')
      await loadCart()
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
          <strong>
            {cart?.fulfillmentMethod === 'DELIVERY'
              ? 'Delivery order'
              : 'Pickup order'}
          </strong>
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
              <span>
                {cart.fulfillmentMethod === 'DELIVERY'
                  ? 'DELIVERY'
                  : 'SELF PICKUP'}
              </span>

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
                  <strong>
                    {cart.fulfillmentMethod === 'DELIVERY'
                      ? 'Delivery to saved address'
                      : 'Pickup from pharmacy'}
                  </strong>

                  <small>
                    {cart.fulfillmentMethod === 'DELIVERY'
                      ? `Address ID · ${cart.deliveryAddressId}`
                      : `Pharmacy ID · ${cart.pharmacyId}`}
                  </small>
                </div>
              </div>
            </section>

            {cart.fulfillmentMethod === 'DELIVERY' &&
              missingDeliveryQuote && (
                <section className="customer-checkout-note">
                  <strong>Delivery quote required.</strong>

                  <p>
                    Return to address selection so MediConnect can calculate
                    a delivery quote for this order.
                  </p>

                  <button
                    type="button"
                    onClick={() => navigate('/app/delivery-address')}
                  >
                    Choose address
                  </button>
                </section>
              )}

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
              disabled={placing || missingDeliveryQuote}
              onClick={placeOrder}
            >
              <span>
                <strong>
                  {placing
                    ? 'Placing order...'
                    : cart.fulfillmentMethod === 'DELIVERY'
                      ? 'Place delivery order'
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
