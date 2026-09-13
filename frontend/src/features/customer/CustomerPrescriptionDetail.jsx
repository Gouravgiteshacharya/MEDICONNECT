import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { getOrder } from '../commerce/orderService'
import {
  createOrderPrescription,
  listOrderPrescriptions,
} from '../commerce/prescriptionService'
import CustomerAuthModal from './CustomerAuthModal'
import './CustomerPrescriptions.css'

const emptyForm = {
  fileUrl: '',
  originalFilename: '',
  storagePath: '',
}

function formatDate(value) {
  if (!value) return 'Not available'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function statusLabel(status) {
  if (!status) return 'Not available'

  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toPrescriptionInput(form) {
  return {
    fileUrl: form.fileUrl.trim(),
    ...(form.originalFilename.trim()
      ? { originalFilename: form.originalFilename.trim() }
      : {}),
    ...(form.storagePath.trim()
      ? { storagePath: form.storagePath.trim() }
      : {}),
  }
}

export default function CustomerPrescriptionDetail() {
  const navigate = useNavigate()
  const { orderId } = useParams()
  const { authenticated, initializing } = useAuth()

  const [order, setOrder] = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [authOpen, setAuthOpen] = useState(false)

  const rxItems = useMemo(
    () => order?.items?.filter((item) => item.requiresPrescription) ?? [],
    [order],
  )
  const canUpload =
    order?.status === 'PRESCRIPTION_PENDING' && rxItems.length > 0

  const loadPrescription = useCallback(async () => {
    if (!authenticated || !orderId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const [orderResult, prescriptionResult] = await Promise.all([
        getOrder(orderId),
        listOrderPrescriptions(orderId),
      ])

      setOrder(orderResult?.order ?? orderResult)
      setPrescriptions(
        prescriptionResult?.prescriptions ??
          prescriptionResult ??
          [],
      )
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load this prescription order.',
      )
    } finally {
      setLoading(false)
    }
  }, [authenticated, orderId])

  useEffect(() => {
    if (initializing) return
    loadPrescription()
  }, [initializing, loadPrescription])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function savePrescription(event) {
    event.preventDefault()

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await createOrderPrescription(orderId, toPrescriptionInput(form))
      setForm(emptyForm)
      await loadPrescription()
      setSuccess('Prescription metadata submitted for pharmacy review.')
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to submit prescription metadata.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="customer-prescriptions-page">
      <header className="customer-prescriptions-header">
        <div>
          <small>PRESCRIPTION DETAIL</small>
          <strong>{order?.orderNumber ?? 'Order prescription'}</strong>
        </div>

        <button type="button" onClick={() => navigate('/app/prescriptions')}>
          Back
        </button>
      </header>

      <main className="customer-prescriptions-main">
        {!authenticated && !initializing && (
          <section className="customer-prescriptions-auth">
            <div>Rx</div>
            <h1>Sign in to manage this prescription.</h1>
            <p>Prescription records are available only to the order owner.</p>
            <button type="button" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </section>
        )}

        {authenticated && loading && (
          <div className="customer-prescriptions-message">
            <strong>Loading prescription...</strong>
          </div>
        )}

        {authenticated && !loading && error && (
          <section className="customer-prescriptions-message">
            <strong>Prescription could not load</strong>
            <span>{error}</span>
            <button type="button" onClick={loadPrescription}>
              Try again
            </button>
          </section>
        )}

        {authenticated && !loading && !error && order && (
          <>
            <section className="customer-prescription-hero">
              <span>{statusLabel(order.status)}</span>
              <h1>Prescription review</h1>
              <p>
                This flow records prescription metadata for the linked order.
                File storage is not handled by this frontend yet.
              </p>
            </section>

            <section className="customer-prescriptions-panel">
              <div className="customer-prescriptions-panel-head">
                <span>RX ITEMS</span>
                <strong>{rxItems.length}</strong>
              </div>

              {rxItems.length > 0 ? (
                <div className="customer-prescriptions-items">
                  {rxItems.map((item) => (
                    <article key={item.id}>
                      <strong>{item.medicineNameSnapshot}</strong>
                      <span>
                        Qty {item.quantity} · {item.brandNameSnapshot ||
                          item.manufacturerSnapshot ||
                          'Medicine'}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="customer-prescriptions-copy">
                  This order does not contain medicine marked as requiring a
                  prescription.
                </p>
              )}
            </section>

            {canUpload ? (
              <section className="customer-prescriptions-panel">
                <div className="customer-prescriptions-panel-head">
                  <span>SUBMIT</span>
                  <strong>Metadata</strong>
                </div>

                <p className="customer-prescriptions-copy">
                  Enter a secure file URL from a storage flow already available
                  to you. MediConnect will store the URL and optional filename
                  for pharmacist review.
                </p>

                <form
                  className="customer-prescription-form"
                  onSubmit={savePrescription}
                >
                  <label>
                    <span>Prescription file URL</span>
                    <input
                      required
                      type="url"
                      name="fileUrl"
                      value={form.fileUrl}
                      placeholder="https://..."
                      onChange={updateField}
                    />
                  </label>

                  <label>
                    <span>Original filename</span>
                    <input
                      name="originalFilename"
                      value={form.originalFilename}
                      placeholder="prescription.pdf"
                      onChange={updateField}
                    />
                  </label>

                  <label>
                    <span>Storage path, if already known</span>
                    <input
                      name="storagePath"
                      value={form.storagePath}
                      placeholder="Optional"
                      onChange={updateField}
                    />
                  </label>

                  <button type="submit" disabled={saving}>
                    {saving ? 'Submitting...' : 'Submit for review'}
                  </button>
                </form>
              </section>
            ) : (
              <section className="customer-prescriptions-panel">
                <div className="customer-prescriptions-panel-head">
                  <span>UPLOAD STATE</span>
                  <strong>Closed</strong>
                </div>
                <p className="customer-prescriptions-copy">
                  Prescription upload is available only while the order is in
                  prescription pending state.
                </p>
              </section>
            )}

            {success && (
              <div className="customer-prescriptions-success">
                {success}
              </div>
            )}

            <section className="customer-prescriptions-panel">
              <div className="customer-prescriptions-panel-head">
                <span>HISTORY</span>
                <strong>{prescriptions.length}</strong>
              </div>

              {prescriptions.length > 0 ? (
                <div className="customer-prescriptions-history">
                  {prescriptions.map((prescription) => (
                    <article key={prescription.id}>
                      <div>
                        <strong>{statusLabel(prescription.status)}</strong>
                        <span>
                          {prescription.originalFilename ||
                            'Prescription metadata'}
                        </span>
                      </div>
                      <small>
                        Uploaded {formatDate(prescription.uploadedAt)}
                      </small>
                      {prescription.reviewNotes && (
                        <p>{prescription.reviewNotes}</p>
                      )}
                      {prescription.rejectionReason && (
                        <p>Reason: {prescription.rejectionReason}</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="customer-prescriptions-copy">
                  No prescription metadata has been submitted for this order.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      <CustomerAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={loadPrescription}
      />
    </div>
  )
}
