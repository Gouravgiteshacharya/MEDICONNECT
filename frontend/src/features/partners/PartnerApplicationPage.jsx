import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Seo from '../../components/Seo'
import { trackEvent } from '../../services/analytics'

import {
  submitPharmacyApplication,
  submitRiderApplication,
} from './partnerApplicationService'
import './PartnerApplicationPage.css'
import './PartnerHardening.css'

const pharmacyInitial = {
  pharmacyName: '', contactName: '', contactEmail: '', phone: '',
  addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
  latitude: '', longitude: '', locationCapturedAt: '', licenseNumber: '',
  gstNumber: '', pharmacistDetails: '', operatingInfo: '',
  pickupAvailable: true, deliverySupportInfo: '', consentAccepted: false,
}

const riderInitial = {
  fullName: '', email: '', phone: '', addressLine1: '', addressLine2: '',
  city: '', state: '', postalCode: '', dateOfBirth: '', vehicleType: 'BIKE',
  vehicleNumber: '', drivingLicenseNumber: '', identityDocumentReference: '',
  emergencyContact: '', consentAccepted: false,
}

function Field({ label, name, value, onChange, required = false, type = 'text', children, ...inputProps }) {
  return (
    <label className="partner-field">
      <span>{label}{required ? ' *' : ''}</span>
      {children || <input name={name} value={value} onChange={onChange} required={required} type={type} {...inputProps} />}
    </label>
  )
}

export default function PartnerApplicationPage() {
  const { partnerType } = useParams()
  const pharmacy = partnerType === 'pharmacy'
  const rider = partnerType === 'rider'
  const [form, setForm] = useState(pharmacy ? pharmacyInitial : riderInitial)
  const [photo, setPhoto] = useState(null)
  const [locationStatus, setLocationStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (pharmacy) trackEvent('partner_pharmacy_application_started')
    if (rider) trackEvent('partner_rider_application_started')
  }, [pharmacy, rider])

  if (!pharmacy && !rider) return <main className="partner-page"><p>Application type not found.</p></main>

  function change(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  function choosePhoto(event) {
    const nextPhoto = event.target.files?.[0] || null
    setError('')
    if (nextPhoto && nextPhoto.size > 10 * 1024 * 1024) {
      event.target.value = ''
      setPhoto(null)
      setError('The pharmacy photo must be 10 MB or smaller.')
      return
    }
    setPhoto(nextPhoto)
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('Browser location is unavailable. Enter the submitted coordinates manually.')
      return
    }
    setLocationStatus('Capturing your current location…')
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        setForm((current) => ({
          ...current,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
          locationCapturedAt: new Date(timestamp).toISOString(),
        }))
        setLocationStatus('Current browser location captured separately from the photo.')
      },
      () => setLocationStatus('Location permission was not granted. Enter the submitted coordinates manually.'),
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      let response
      if (pharmacy) {
        if (!photo) throw new Error('Please add a clear pharmacy photo.')
        const body = new FormData()
        Object.entries(form).forEach(([key, value]) => body.append(key, String(value)))
        body.append('photo', photo)
        response = await submitPharmacyApplication(body)
      } else {
        response = await submitRiderApplication({
          ...form,
          dateOfBirth: form.dateOfBirth || undefined,
          vehicleNumber: form.vehicleNumber || undefined,
          drivingLicenseNumber: form.drivingLicenseNumber || undefined,
          identityDocumentReference: form.identityDocumentReference || undefined,
          emergencyContact: form.emergencyContact || undefined,
          addressLine2: form.addressLine2 || undefined,
        })
      }
      setResult(response)
      trackEvent(pharmacy ? 'partner_pharmacy_application_submitted' : 'partner_rider_application_submitted')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <main className="partner-page">
        <Seo title={pharmacy ? 'Partner with MediConnect' : 'Become a MediConnect Delivery Partner'} description={pharmacy ? 'Apply to join MediConnect as a participating local pharmacy.' : 'Apply to become a verified MediConnect delivery partner.'} path={`/partner/${partnerType}/apply`} />
        <section className="partner-success">
          <span>M</span>
          <small>APPLICATION SUBMITTED</small>
          <h1>Thank you for applying.</h1>
          <p>{result.message}</p>
          <strong>Reference: {result.application?.id}</strong>
          <Link to="/">Return to MediConnect</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="partner-page">
      <Seo title={pharmacy ? 'Partner with MediConnect' : 'Become a MediConnect Delivery Partner'} description={pharmacy ? 'Apply to join MediConnect as a participating local pharmacy.' : 'Apply to become a verified MediConnect delivery partner.'} path={`/partner/${partnerType}/apply`} />
      <header className="partner-header">
        <Link to="/" className="partner-brand"><span>M</span><strong>MediConnect</strong></Link>
        <Link to="/?auth=login&audience=staff">Already approved? Staff &amp; Partner Login</Link>
      </header>
      <section className="partner-intro">
        <small>WORK WITH MEDICONNECT</small>
        <h1>{pharmacy ? 'Join as a pharmacy' : 'Become a delivery partner'}</h1>
        <p>{pharmacy
          ? 'Apply online. Our team will review your documents, visit your pharmacy, verify its details and location, and activate access only after approval.'
          : 'Apply online, then complete mandatory in-person verification before your rider account can be activated.'}</p>
      </section>
      <form className="partner-form" onSubmit={submit}>
        <div className="partner-form-grid">
          {pharmacy ? (
            <>
              <Field label="Pharmacy name" name="pharmacyName" value={form.pharmacyName} onChange={change} maxLength={160} required />
              <Field label="Owner / contact name" name="contactName" value={form.contactName} onChange={change} maxLength={120} required />
              <Field label="Contact email" name="contactEmail" value={form.contactEmail} onChange={change} type="email" maxLength={254} autoComplete="email" required />
              <Field label="Phone" name="phone" value={form.phone} onChange={change} minLength={7} maxLength={20} inputMode="tel" autoComplete="tel" required />
            </>
          ) : (
            <>
              <Field label="Full name" name="fullName" value={form.fullName} onChange={change} maxLength={120} required />
              <Field label="Email" name="email" value={form.email} onChange={change} type="email" maxLength={254} autoComplete="email" required />
              <Field label="Phone" name="phone" value={form.phone} onChange={change} minLength={7} maxLength={20} inputMode="tel" autoComplete="tel" required />
              <Field label="Date of birth" name="dateOfBirth" value={form.dateOfBirth} onChange={change} type="date" />
            </>
          )}
          <Field label={pharmacy ? 'Pharmacy address' : 'Home / local address'} name="addressLine1" value={form.addressLine1} onChange={change} maxLength={200} autoComplete="street-address" required />
          <Field label="Address line 2" name="addressLine2" value={form.addressLine2} onChange={change} maxLength={200} />
          <Field label="City / locality" name="city" value={form.city} onChange={change} maxLength={100} autoComplete="address-level2" required />
          <Field label="State" name="state" value={form.state} onChange={change} maxLength={100} autoComplete="address-level1" required />
          <Field label="Postal code" name="postalCode" value={form.postalCode} onChange={change} maxLength={12} autoComplete="postal-code" required />
          {pharmacy ? (
            <>
              <Field label="Latitude" name="latitude" value={form.latitude} onChange={change} type="number" min="-90" max="90" step="any" required />
              <Field label="Longitude" name="longitude" value={form.longitude} onChange={change} type="number" min="-180" max="180" step="any" required />
              <div className="partner-location-action">
                <button type="button" onClick={captureLocation}>Capture current location</button>
                <small>{locationStatus || 'Browser location is stored separately and is not treated as proof by itself.'}</small>
              </div>
              <Field label="Pharmacy licence number" name="licenseNumber" value={form.licenseNumber} onChange={change} required />
              <Field label="GST number (optional)" name="gstNumber" value={form.gstNumber} onChange={change} />
              <Field label="Pharmacist details" name="pharmacistDetails" value={form.pharmacistDetails} onChange={change} />
              <Field label="Basic operating information" name="operatingInfo" value={form.operatingInfo} onChange={change} required />
              <Field label="Delivery-support information" name="deliverySupportInfo" value={form.deliverySupportInfo} onChange={change} />
              <label className="partner-field partner-photo">
                <span>Pharmacy photo *</span>
                <input type="file" accept="image/jpeg,image/png" required onChange={choosePhoto} />
                <small>Please take/upload a clear photo of the pharmacy while you are physically at the pharmacy location. MediConnect will verify the submitted location during the field visit.</small>
              </label>
              <label className="partner-check"><input type="checkbox" name="pickupAvailable" checked={form.pickupAvailable} onChange={change} /> Pickup is available</label>
            </>
          ) : (
            <>
              <Field label="Vehicle type" name="vehicleType" value={form.vehicleType} onChange={change} required>
                <select name="vehicleType" value={form.vehicleType} onChange={change}><option>BIKE</option><option>SCOOTER</option><option>BICYCLE</option><option>CAR</option><option>WALKER</option></select>
              </Field>
              <Field label="Vehicle number" name="vehicleNumber" value={form.vehicleNumber} onChange={change} />
              <Field label="Driving licence number" name="drivingLicenseNumber" value={form.drivingLicenseNumber} onChange={change} maxLength={80} required={!['BICYCLE', 'WALKER'].includes(form.vehicleType)} />
              <Field label="Identity document reference" name="identityDocumentReference" value={form.identityDocumentReference} onChange={change} />
              <Field label="Emergency contact" name="emergencyContact" value={form.emergencyContact} onChange={change} />
              <div className="partner-notice"><strong>In-person verification is mandatory.</strong><p>MediConnect will contact you with the nearest verification centre and appointment details. No office location is assigned by this form.</p></div>
            </>
          )}
        </div>
        <label className="partner-check partner-consent"><input type="checkbox" name="consentAccepted" checked={form.consentAccepted} onChange={change} required /> I confirm these details are accurate and consent to MediConnect verification.</label>
        {error && <p className="partner-error" role="alert">{error}</p>}
        <button className="partner-submit" type="submit" disabled={submitting}>{submitting ? 'Submitting application…' : 'Submit application'}</button>
      </form>
    </main>
  )
}
