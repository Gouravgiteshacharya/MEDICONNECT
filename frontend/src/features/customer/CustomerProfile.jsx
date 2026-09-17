import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
} from './addressService'
import CustomerAuthModal from './CustomerAuthModal'
import { getProfile, updateProfile } from './userService'
import './CustomerProfile.css'

const emptyAddressForm = {
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

function toAddressInput(form) {
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
    ...(form.latitude.trim()
      ? { latitude: Number(form.latitude) }
      : {}),
    ...(form.longitude.trim()
      ? { longitude: Number(form.longitude) }
      : {}),
    isDefault: form.isDefault,
  }
}

export default function CustomerProfile() {
  const navigate = useNavigate()
  const {
    authenticated,
    initializing,
    logout,
    refreshUser,
  } = useAuth()

  const [profile, setProfile] = useState(null)
  const [profileForm, setProfileForm] = useState({
    name: '',
    email: '',
    phone: '',
  })
  const [addresses, setAddresses] = useState([])
  const [addressForm, setAddressForm] = useState(emptyAddressForm)

  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)
  const [locating, setLocating] = useState(false)
  const [busyAddressId, setBusyAddressId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const loadProfile = useCallback(async () => {
    if (!authenticated) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [currentProfile, currentAddresses] = await Promise.all([
        getProfile(),
        listAddresses(),
      ])

      setProfile(currentProfile)
      setProfileForm({
        name: currentProfile.name ?? '',
        email: currentProfile.email ?? '',
        phone: currentProfile.phone ?? '',
      })
      setAddresses(currentAddresses)
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load your profile.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated])

  useEffect(() => {
    if (initializing) return
    loadProfile()
  }, [initializing, loadProfile])

  function updateProfileField(event) {
    const { name, value } = event.target

    setProfileForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function updateAddressField(event) {
    const { checked, name, type, value } = event.target

    setAddressForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  async function saveProfile(event) {
    event.preventDefault()

    setSavingProfile(true)
    setError('')
    setSuccess('')

    try {
      const updated = await updateProfile({
        name: profileForm.name.trim(),
        email: profileForm.email.trim(),
        phone: profileForm.phone.trim() || null,
      })

      setProfile(updated)
      await refreshUser()
      setSuccess('Profile updated.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update your profile.',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function addAddress(event) {
    event.preventDefault()

    setSavingAddress(true)
    setError('')
    setSuccess('')

    try {
      await createAddress(toAddressInput(addressForm))
      setAddressForm(emptyAddressForm)
      setAddresses(await listAddresses())
      setSuccess('Address saved.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to save this address.',
      )
    } finally {
      setSavingAddress(false)
    }
  }

  function useCurrentLocation() {
    setError('')
    setSuccess('')

    if (!navigator.geolocation) {
      setError('Location access is not supported by this browser.')
      return
    }

    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAddressForm((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }))
        setSuccess('Delivery location captured for this address.')
        setLocating(false)
      },
      () => {
        setError('Allow location access to add a delivery-ready location.')
        setLocating(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
  }

  async function makeDefault(addressId) {
    setBusyAddressId(addressId)
    setError('')
    setSuccess('')

    try {
      await updateAddress(addressId, { isDefault: true })
      setAddresses(await listAddresses())
      setSuccess('Default address updated.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update this address.',
      )
    } finally {
      setBusyAddressId(null)
    }
  }

  async function removeAddress(addressId) {
    setBusyAddressId(addressId)
    setError('')
    setSuccess('')

    try {
      await deleteAddress(addressId)
      setAddresses(await listAddresses())
      setSuccess('Address removed.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to remove this address.',
      )
    } finally {
      setBusyAddressId(null)
    }
  }

  return (
    <div className="customer-profile-page">
      <header className="customer-profile-header">
        <div>
          <small>YOUR ACCOUNT</small>
          <strong>Profile</strong>
        </div>

        {authenticated && (
          <button
            type="button"
            onClick={() => {
              logout()
              navigate('/', { replace: true })
            }}
          >
            Log out
          </button>
        )}
      </header>

      <main className="customer-profile-main">
        {!authenticated && !initializing && (
          <section className="customer-profile-auth">
            <div>M</div>
            <h1>Sign in to manage your profile.</h1>
            <p>Your profile and saved addresses stay with your account.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-profile-message">
            <strong>Loading profile...</strong>
          </div>
        )}

        {authenticated && !loading && profile && (
          <div className="customer-profile-layout">
            <section className="customer-profile-card customer-profile-identity">
              <span>ACCOUNT</span>
              <h1>{profile.name}</h1>
              <p>{profile.email}</p>
              <small>{profile.role}</small>
            </section>

            <section className="customer-profile-card">
              <div className="customer-profile-section-head">
                <div>
                  <span>PROFILE</span>
                  <h2>Personal details</h2>
                </div>
              </div>

              <form className="customer-profile-form" onSubmit={saveProfile}>
                <label>
                  <span>Name</span>
                  <input
                    name="name"
                    value={profileForm.name}
                    onChange={updateProfileField}
                    autoComplete="name"
                    required
                  />
                </label>

                <label>
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    value={profileForm.email}
                    onChange={updateProfileField}
                    autoComplete="email"
                    required
                  />
                </label>

                <label>
                  <span>Phone</span>
                  <input
                    name="phone"
                    value={profileForm.phone}
                    onChange={updateProfileField}
                    autoComplete="tel"
                    inputMode="tel"
                  />
                </label>

                <button type="submit" disabled={savingProfile}>
                  {savingProfile ? 'Saving...' : 'Save profile'}
                </button>
              </form>
            </section>

            <section className="customer-profile-card">
              <div className="customer-profile-section-head">
                <div>
                  <span>ADDRESSES</span>
                  <h2>Saved addresses</h2>
                </div>
              </div>

              {addresses.length === 0 ? (
                <p className="customer-profile-copy">
                  Add a delivery address to use it during checkout.
                </p>
              ) : (
                <div className="customer-profile-addresses">
                  {addresses.map((address) => (
                    <article key={address.id}>
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
                      </div>

                      <div className="customer-profile-address-actions">
                        {!address.isDefault && (
                          <button
                            type="button"
                            disabled={busyAddressId === address.id}
                            onClick={() => makeDefault(address.id)}
                          >
                            Default
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busyAddressId === address.id}
                          onClick={() => removeAddress(address.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <form className="customer-profile-form" onSubmit={addAddress}>
                <div className="customer-profile-form-grid">
                  <label>
                    <span>Label</span>
                    <input
                      name="label"
                      value={addressForm.label}
                      onChange={updateAddressField}
                      placeholder="Home"
                      required
                    />
                  </label>

                  <label>
                    <span>Postal code</span>
                    <input
                      name="postalCode"
                      value={addressForm.postalCode}
                      onChange={updateAddressField}
                      autoComplete="postal-code"
                      required
                    />
                  </label>
                </div>

                <label>
                  <span>Address line 1</span>
                  <input
                    name="addressLine1"
                    value={addressForm.addressLine1}
                    onChange={updateAddressField}
                    autoComplete="address-line1"
                    required
                  />
                </label>

                <label>
                  <span>Address line 2</span>
                  <input
                    name="addressLine2"
                    value={addressForm.addressLine2}
                    onChange={updateAddressField}
                    autoComplete="address-line2"
                  />
                </label>

                <label>
                  <span>Landmark</span>
                  <input
                    name="landmark"
                    value={addressForm.landmark}
                    onChange={updateAddressField}
                  />
                </label>

                <div className="customer-profile-form-grid">
                  <label>
                    <span>City</span>
                    <input
                      name="city"
                      value={addressForm.city}
                      onChange={updateAddressField}
                      autoComplete="address-level2"
                      required
                    />
                  </label>

                  <label>
                    <span>State</span>
                    <input
                      name="state"
                      value={addressForm.state}
                      onChange={updateAddressField}
                      autoComplete="address-level1"
                      required
                    />
                  </label>
                </div>

                <div className="customer-profile-location-capture">
                  <div>
                    <strong>Delivery location</strong>
                    <span>
                      {addressForm.latitude && addressForm.longitude
                        ? 'Location captured for delivery quotes.'
                        : 'Use browser location to make this address delivery-ready.'}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={locating}
                    onClick={useCurrentLocation}
                  >
                    {locating ? 'Getting location...' : 'Use current location'}
                  </button>
                </div>

                <label className="customer-profile-checkbox">
                  <input
                    name="isDefault"
                    type="checkbox"
                    checked={addressForm.isDefault}
                    onChange={updateAddressField}
                  />
                  <span>Use as default address</span>
                </label>

                <button type="submit" disabled={savingAddress}>
                  {savingAddress ? 'Saving...' : 'Add address'}
                </button>
              </form>
            </section>
          </div>
        )}

        {error && (
          <div className="customer-profile-error">
            {error}
          </div>
        )}

        {success && (
          <div className="customer-profile-success">
            {success}
          </div>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={loadProfile}
      />
    </div>
  )
}
