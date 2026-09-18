import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { getPrescription, getPrescriptionDocumentAccess } from '../commerce/prescriptionService'
import './CustomerPrescriptions.css'

function formatDate(value) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(value) {
  return value?.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || 'Not available'
}

export default function CustomerPrescriptionDetail() {
  const navigate = useNavigate()
  const { prescriptionId } = useParams()
  const [prescription, setPrescription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await getPrescription(prescriptionId); setPrescription(result.prescription) }
    catch (requestError) { setError(requestError?.message || 'Unable to load this prescription.') }
    finally { setLoading(false) }
  }, [prescriptionId])

  useEffect(() => { load() }, [load])

  async function openDocument() {
    setOpening(true); setError('')
    try {
      const result = await getPrescriptionDocumentAccess(prescriptionId)
      window.open(result.documentAccess.url, '_blank', 'noopener,noreferrer')
    } catch (requestError) { setError(requestError?.message || 'Unable to open this document.') }
    finally { setOpening(false) }
  }

  return <div className="customer-prescriptions-page">
    <header className="customer-prescriptions-header"><div><small>PRESCRIPTION DETAIL</small><strong>{prescription?.originalFilename || 'Prescription'}</strong></div><button type="button" onClick={() => navigate('/app/prescriptions')}>Back</button></header>
    <main className="customer-prescriptions-main">
      {loading && <div className="customer-prescriptions-message"><strong>Loading prescription…</strong></div>}
      {error && <div className="customer-prescriptions-message"><strong>Something needs attention</strong><span>{error}</span></div>}
      {prescription && <><section className="customer-prescription-hero"><span>{statusLabel(prescription.status)}</span><h1>{prescription.originalFilename || 'Prescription document'}</h1><p>Uploaded {formatDate(prescription.uploadedAt)} for order {prescription.order.orderNumber}.</p></section>
        <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>DOCUMENT</span><strong>Private</strong></div><p className="customer-prescriptions-copy">MediConnect creates a short-lived authorized link only when you open the document.</p><button className="customer-prescription-primary" type="button" disabled={opening} onClick={openDocument}>{opening ? 'Preparing secure link…' : 'Open document'}</button></section>
        <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>REVIEW</span><strong>{statusLabel(prescription.status)}</strong></div>{prescription.reviewedAt && <p className="customer-prescriptions-copy">Reviewed {formatDate(prescription.reviewedAt)}</p>}{prescription.reviewNotes && <p className="customer-prescriptions-copy">{prescription.reviewNotes}</p>}{prescription.rejectionReason && <p className="customer-prescriptions-copy">Reason: {prescription.rejectionReason}</p>}{prescription.supersededByPrescription && <p className="customer-prescriptions-copy">Superseded by a newer document.</p>}
          {prescription.status === 'ADDITIONAL_INFO_REQUIRED' && !prescription.supersededByPrescription && <button className="customer-prescription-primary" type="button" onClick={() => navigate(`/app/orders/${prescription.orderId}/prescription?supersedesPrescriptionId=${prescription.id}`)}>Upload replacement</button>}
        </section>
      </>}
    </main>
  </div>
}
