import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import {
  getCart,
  setDeliveryFulfillment,
} from '../commerce/cartService'
import { createDeliveryQuote } from '../commerce/deliveryQuoteService'
import {
  createAddress,
  listAddresses,
} from './addressService'
import CustomerAuthModal from './CustomerAuthModal'
import { destinationFromAddress, useCustomerDestination } from './CustomerDestinationContext'
import './CustomerDeliveryAddress.css'

const emptyForm = {
  label: '',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
  city: '',
  state: '',
  postalCode: '',
  latitude: '',
  longitude: '',
  isDefault: false,
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  )
}

function hasCoordinateValue(value) {
  return value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value))
}

function hasCoordinates(address) {
  return (
    hasCoordinateValue(address.latitude) &&
    hasCoordinateValue(address.longitude)
  )
}

function addressInput(form) {
  const latitude = Number(form.latitude)
  const longitude = Number(form.longitude)
  const hasLocation = hasCoordinates(form)

  return {
    label: form.label.trim(),
    addressLine1: form.addressLine1.trim(),
    ...(form.addressLine2.trim()
      ? { addressLine2: form.addressLine2.trim() }
      : {}),
    ...(form.landmark.trim()
      ? { landmark: form.landmark.trim() }
      : {}),
    city: form.city.trim(),
    state: form.state.trim(),
    postalCode: form.postalCode.trim(),
    ...(hasLocation
      ? {
          latitude,
          longitude,
        }
      : {}),
    isDefault: form.isDefault,
  }
}

export default function CustomerDeliveryAddress() {
  const navigate = useNavigate()
  const { authenticated, initializing } = useAuth()
  const { destination, setDestination } = useCustomerDestination()

  const [cart, setCart] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [form, setForm] = useState(emptyForm)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [selectingId, setSelectingId] = useState(null)
  const [error, setError] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const load = useCallback(async () => {
    if (!authenticated) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [cartResult, addressResult] = await Promise.all([
        getCart(),
        listAddresses(),
      ])

      setCart(cartResult?.cart ?? cartResult ?? null)
      setAddresses(addressResult)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load delivery details.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return
    load()
  }, [initializing, load])

  function updateField(event) {
    const { checked, name, type, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  async function addAddress(event) {
    event.preventDefault()

    setSaving(true)
    setError('')

    try {
      await createAddress(addressInput(form))
      setForm(emptyForm)
      setAddresses(await listAddresses())
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to save this address.',
      )
    } finally {
      setSaving(false)
    }
  }

  function useCurrentLocation() {
    setError('')

    if (!navigator.geolocation) {
      setError('Location access is not supported by this browser.')
      return
    }

    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }))
        setLocating(false)
      },
      () => {
        setError('Allow location access to prepare this address for delivery quotes.')
        setLocating(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
  }

  async function chooseAddress(address) {
    if (!cart?.pharmacyId) {
      setError('Your cart needs a selected pharmacy before delivery can continue.')
      return
    }

    if (!hasCoordinates(address)) {
      setError('Choose or save an address with a usable delivery location before requesting a quote.')
      return
    }

    setSelectingId(address.id)
    setError('')

    try {
      await setDeliveryFulfillment(address.id)
      setDestination(destinationFromAddress(address))
      const quote = await createDeliveryQuote({
        pharmacyId: cart.pharmacyId,
        deliveryAddressId: address.id,
      })

      navigate(`/app/checkout?deliveryQuoteId=${encodeURIComponent(quote.id)}`)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to prepare delivery checkout.',
      )
    } finally {
      setSelectingId(null)
    }
  }

  return (
    <div className="customer-delivery-page">
      <header className="customer-delivery-header">
        <button
          type="button"
          aria-label="Back to cart"
          onClick={() => navigate('/app/cart')}
        >
          <BackIcon />
        </button>

        <div>
          <small>DELIVERY ADDRESS</small>
          <strong>Choose address</strong>
        </div>
      </header>

      <main className="customer-delivery-main">
        {!authenticated && !initializing && (
          <section className="customer-delivery-auth">
            <div>M</div>
            <h1>Sign in to choose delivery.</h1>
            <p>Delivery addresses are linked to your customer account.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-delivery-message">
            <strong>Loading delivery options...</strong>
          </div>
        )}

        {authenticated && !loading && !cart && (
          <section className="customer-delivery-empty">
            <div>+</div>
            <h1>No active cart.</h1>
            <p>Add a medicine from a nearby pharmacy before choosing delivery.</p>
            <button type="button" onClick={() => navigate('/app/search')}>
              Search medicines
            </button>
          </section>
        )}

        {authenticated && !loading && cart && (
          <>
            <section className="customer-delivery-intro">
              <span>DELIVERY CHECKOUT</span>
              <h1>Where should this order go?</h1>
              <p>
                Choose a saved address with a usable delivery location so
                MediConnect can calculate a delivery quote.
              </p>
            </section>

            {addresses.length > 0 && (
              <section className="customer-delivery-list">
                {addresses.map((address) => (
                  <article key={address.id} className={destination?.addressId === address.id ? 'selected' : ''}>
                    <div>
                      <strong>
                        {address.label}
                        {address.isDefault && <span>Default</span>}
                      </strong>

                      <p>
                        {address.addressLine1}
                        {address.addressLine2
                          ? `, ${address.addressLine2}`
                          : ''}
                      </p>

                      <small>
                        {address.city}, {address.state} {address.postalCode}
                      </small>

                      {!hasCoordinates(address) && (
                        <em>Delivery location required for quote</em>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={
                        selectingId === address.id ||
                        !hasCoordinates(address)
                      }
                      onClick={() => chooseAddress(address)}
                    >
                      {selectingId === address.id
                        ? 'Checking...'
                        : destination?.addressId === address.id
                          ? 'Selected · continue'
                          : 'Use'}
                    </button>
                  </article>
                ))}
              </section>
            )}

            <section className="customer-delivery-card">
              <div className="customer-delivery-section-head">
                <span>NEW ADDRESS</span>
                <h2>Add delivery address</h2>
              </div>

              <form className="customer-delivery-form" onSubmit={addAddress}>
                <button
                  className="customer-delivery-location-button"
                  type="button"
                  disabled={locating}
                  onClick={useCurrentLocation}
                >
                  {locating ? 'Getting location...' : 'Use current location'}
                </button>

                <p className="customer-delivery-coordinate-summary">
                  {hasCoordinates(form)
                    ? 'Delivery location captured for this address.'
                    : 'Location is required before this address can be used for delivery quotes.'}
                </p>

                <div className="customer-delivery-form-grid">
                  <label>
                    <span>Label</span>
                    <input
                      name="label"
                      value={form.label}
                      onChange={updateField}
                      placeholder="Home"
                      required
                    />
                  </label>

                  <label>
                    <span>Postal code</span>
                    <input
                      name="postalCode"
                      value={form.postalCode}
                      onChange={updateField}
                      autoComplete="postal-code"
                      required
                    />
                  </label>
                </div>

                <label>
                  <span>Address line 1</span>
                  <input
                    name="addressLine1"
                    value={form.addressLine1}
                    onChange={updateField}
                    autoComplete="address-line1"
                    required
                  />
                </label>

                <label>
                  <span>Address line 2</span>
                  <input
                    name="addressLine2"
                    value={form.addressLine2}
                    onChange={updateField}
                    autoComplete="address-line2"
                  />
                </label>

                <label>
                  <span>Landmark</span>
                  <input
                    name="landmark"
                    value={form.landmark}
                    onChange={updateField}
                  />
                </label>

                <div className="customer-delivery-form-grid">
                  <label>
                    <span>City</span>
                    <input
                      name="city"
                      value={form.city}
                      onChange={updateField}
                      autoComplete="address-level2"
                      required
                    />
                  </label>

                  <label>
                    <span>State</span>
                    <input
                      name="state"
                      value={form.state}
                      onChange={updateField}
                      autoComplete="address-level1"
                      required
                    />
                  </label>
                </div>

                <label className="customer-delivery-checkbox">
                  <input
                    name="isDefault"
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={updateField}
                  />
                  <span>Use as default address</span>
                </label>

                <button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save address'}
                </button>
              </form>
            </section>
          </>
        )}

        {error && (
          <div className="customer-delivery-error">
            {error}
          </div>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={load}
      />
    </div>
  )
}
