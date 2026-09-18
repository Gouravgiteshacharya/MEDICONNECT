import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  labelFromEnum,
  formatDate,
  getPharmacyPrescription,
  reviewPharmacyPrescription,
} from './pharmacyService'
import { usePharmacyContext } from './pharmacyWorkspace'

const emptyForm = {
  status: 'APPROVED',
  reviewNotes: '',
  rejectionReason: '',
}

function reviewPayload(form) {
  if (form.status === 'REJECTED') {
    return {
      status: 'REJECTED',
      rejectionReason: form.rejectionReason.trim(),
      ...(form.reviewNotes.trim()
        ? { reviewNotes: form.reviewNotes.trim() }
        : {}),
    }
  }

  if (form.status === 'ADDITIONAL_INFO_REQUIRED') {
    return {
      status: 'ADDITIONAL_INFO_REQUIRED',
      reviewNotes: form.reviewNotes.trim(),
    }
  }

  return {
    status: 'APPROVED',
    ...(form.reviewNotes.trim()
      ? { reviewNotes: form.reviewNotes.trim() }
      : {}),
  }
}

export default function PharmacyPrescriptionReview() {
  const navigate = useNavigate()
  const { prescriptionId } = useParams()
  const { pharmacyId, pathWithPharmacy } = usePharmacyContext()

  const [form, setForm] = useState(emptyForm)
  const [result, setResult] = useState(null)
  const [prescription, setPrescription] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try { setPrescription(await getPharmacyPrescription(pharmacyId, prescriptionId)) }
    catch (requestError) { setError(requestError?.message || 'Unable to load this prescription.') }
  }

  useEffect(() => { load() }, [pharmacyId, prescriptionId])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function submitReview(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      setResult(
        await reviewPharmacyPrescription(
          pharmacyId,
          prescriptionId,
          reviewPayload(form),
        ),
      )
      await load()
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to submit prescription review.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>PRESCRIPTION REVIEW</span>
          <h1>{prescription ? labelFromEnum(prescription.status) : 'Loading prescription...'}</h1>
          <p>
            Pharmacist membership is required by the backend. This page does
            not interpret medical content or provide treatment advice.
          </p>
        </div>

        <button
          type="button"
          className="pharmacy-secondary-button"
          onClick={() => navigate(pathWithPharmacy('/pharmacy/prescriptions'))}
        >
          Back
        </button>
      </header>

      {prescription && (
        <section className="pharmacy-card pharmacy-message">
          <strong>Order {prescription.order.orderNumber}</strong>
          <p>Order status: {labelFromEnum(prescription.order.status)}</p>
          <p>Uploaded: {formatDate(prescription.uploadedAt)} · Reviewed: {formatDate(prescription.reviewedAt)}</p>
          {prescription.reviewNotes && <p>Notes: {prescription.reviewNotes}</p>}
          {prescription.rejectionReason && <p>Reason: {prescription.rejectionReason}</p>}
        </section>
      )}

      <form className="pharmacy-form-panel" onSubmit={submitReview}>
        <h2>{prescriptionId}</h2>
        <p>
          Review is allowed only while the linked order remains in prescription
          pending state.
        </p>

        <div className="pharmacy-review-form">
          <label>
            <span>Review decision</span>
            <select
              name="status"
              value={form.status}
              onChange={updateField}
            >
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="ADDITIONAL_INFO_REQUIRED">
                Additional info required
              </option>
            </select>
          </label>

          <label>
            <span>
              {form.status === 'ADDITIONAL_INFO_REQUIRED'
                ? 'Review notes'
                : 'Review notes, optional'}
            </span>
            <textarea
              required={form.status === 'ADDITIONAL_INFO_REQUIRED'}
              name="reviewNotes"
              value={form.reviewNotes}
              onChange={updateField}
            />
          </label>

          {form.status === 'REJECTED' && (
            <label>
              <span>Rejection reason</span>
              <textarea
                required
                name="rejectionReason"
                value={form.rejectionReason}
                onChange={updateField}
              />
            </label>
          )}

          <button type="submit" className="pharmacy-button" disabled={busy}>
            {busy ? 'Submitting...' : 'Submit review'}
          </button>
        </div>
      </form>

      {error && <div className="pharmacy-feedback error">{error}</div>}

      {result && (
        <section className="pharmacy-card pharmacy-message">
          <strong>{labelFromEnum(result.status)}</strong>
          <p>Prescription ID: {result.id}</p>
          <p>Order ID: {result.orderId}</p>
          {result.reviewNotes && <p>Notes: {result.reviewNotes}</p>}
          {result.rejectionReason && <p>Reason: {result.rejectionReason}</p>}
        </section>
      )}
    </main>
  )
}
