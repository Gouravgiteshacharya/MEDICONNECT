import { useCallback, useEffect, useState } from 'react'

import {
  getPharmacyProfile,
  labelFromEnum,
  updatePharmacyProfile,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

const emptyForm = {
  name: '',
  description: '',
  phone: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  latitude: '',
  longitude: '',
}

function profileToForm(profile) {
  return {
    name: profile.name ?? '',
    description: profile.description ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    postalCode: profile.postalCode ?? '',
    latitude: profile.latitude == null ? '' : String(profile.latitude),
    longitude: profile.longitude == null ? '' : String(profile.longitude),
  }
}

function formToPayload(form) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    phone: form.phone.trim(),
    email: form.email.trim() || null,
    addressLine1: form.addressLine1.trim(),
    addressLine2: form.addressLine2.trim() || null,
    city: form.city.trim(),
    state: form.state.trim(),
    postalCode: form.postalCode.trim(),
    latitude: form.latitude.trim() ? Number(form.latitude) : null,
    longitude: form.longitude.trim() ? Number(form.longitude) : null,
  }
}

export default function PharmacyProfile() {
  const { pharmacyId } = usePharmacyContext()

  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await getPharmacyProfile(pharmacyId)
      setProfile(result)
      setForm(profileToForm(result))
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load pharmacy profile.',
      )
    } finally {
      setLoading(false)
    }
  }, [pharmacyId])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const updated = await updatePharmacyProfile(pharmacyId, formToPayload(form))
      setProfile(updated)
      setForm(profileToForm(updated))
      setSuccess('Pharmacy profile updated.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to update pharmacy profile.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>PROFILE</span>
          <h1>{profile?.name ?? 'Pharmacy profile'}</h1>
          <p>
            Operational pharmacy fields are loaded from the authenticated
            pharmacy profile endpoint.
          </p>
        </div>
      </header>

      {loading && (
        <div className="pharmacy-message">
          <strong>Loading profile...</strong>
        </div>
      )}

      {error && <div className="pharmacy-feedback error">{error}</div>}
      {success && <div className="pharmacy-feedback">{success}</div>}

      {!loading && profile && (
        <>
          <section className="pharmacy-grid pharmacy-metrics">
            <article className="pharmacy-card pharmacy-metric">
              <small>PARTNER STATUS</small>
              <strong>{labelFromEnum(profile.partnerStatus)}</strong>
              <p>Returned by pharmacy profile API</p>
            </article>
            <article className="pharmacy-card pharmacy-metric">
              <small>VERIFICATION</small>
              <strong>{profile.isVerified ? 'Verified' : 'Not verified'}</strong>
              <p>Stored pharmacy verification field</p>
            </article>
            <article className="pharmacy-card pharmacy-metric">
              <small>ACTIVE</small>
              <strong>{profile.isActive ? 'Yes' : 'No'}</strong>
              <p>Operational availability in backend</p>
            </article>
            <article className="pharmacy-card pharmacy-metric">
              <small>INVENTORY MODE</small>
              <strong>{labelFromEnum(profile.inventoryManagementMode)}</strong>
              <p>Configured backend inventory mode</p>
            </article>
          </section>

          <section className="pharmacy-form-panel">
            <h2>Edit operational profile</h2>
            <p>
              Owner or manager membership is required by the backend for
              updates.
            </p>

            <form
              className="pharmacy-form-grid full"
              onSubmit={saveProfile}
            >
              <label>
                <span>Name</span>
                <input
                  required
                  name="name"
                  value={form.name}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  required
                  name="phone"
                  value={form.phone}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Address line 1</span>
                <input
                  required
                  name="addressLine1"
                  value={form.addressLine1}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Address line 2</span>
                <input
                  name="addressLine2"
                  value={form.addressLine2}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>City</span>
                <input
                  required
                  name="city"
                  value={form.city}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>State</span>
                <input
                  required
                  name="state"
                  value={form.state}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Postal code</span>
                <input
                  required
                  name="postalCode"
                  value={form.postalCode}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Latitude</span>
                <input
                  name="latitude"
                  value={form.latitude}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Longitude</span>
                <input
                  name="longitude"
                  value={form.longitude}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateField}
                />
              </label>

              <button
                type="submit"
                className="pharmacy-button"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save profile'}
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  )
}
