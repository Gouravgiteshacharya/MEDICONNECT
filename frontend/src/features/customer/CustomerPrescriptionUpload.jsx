import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { getOrder } from '../commerce/orderService'
import { createOrderPrescription, listOrderPrescriptions } from '../commerce/prescriptionService'
import './CustomerPrescriptions.css'

const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png']

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `rx-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function statusLabel(value) {
  return value?.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') || 'Not available'
}

export default function CustomerPrescriptionUpload() {
  const navigate = useNavigate()
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const supersedesPrescriptionId = searchParams.get('supersedesPrescriptionId') || ''
  const intentKey = useRef(newIdempotencyKey())
  const [order, setOrder] = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const rxItems = useMemo(() => order?.items?.filter((item) => item.requiresPrescription) ?? [], [order])
  const canUpload = order?.status === 'PRESCRIPTION_PENDING' && rxItems.length > 0

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [orderResult, prescriptionResult] = await Promise.all([getOrder(orderId), listOrderPrescriptions(orderId)])
      setOrder(orderResult.order ?? orderResult)
      setPrescriptions(prescriptionResult.prescriptions ?? prescriptionResult)
    } catch (requestError) { setError(requestError?.message || 'Unable to load prescription upload.') }
    finally { setLoading(false) }
  }, [orderId])

  useEffect(() => { load() }, [load])

  function chooseFile(event) {
    const nextFile = event.target.files?.[0] ?? null
    setError('')
    if (nextFile && !acceptedTypes.includes(nextFile.type)) {
      setFile(null)
      setError('Choose a PDF, JPEG, or PNG prescription document.')
      return
    }
    setFile(nextFile)
    intentKey.current = newIdempotencyKey()
  }

  async function upload(event) {
    event.preventDefault()
    if (!file) { setError('Choose a prescription document first.'); return }
    setSaving(true); setError('')
    try {
      const result = await createOrderPrescription(orderId, {
        file,
        idempotencyKey: intentKey.current,
        ...(supersedesPrescriptionId ? { supersedesPrescriptionId } : {}),
      })
      const prescription = result.prescription ?? result
      navigate(`/app/prescriptions/${prescription.id}`, { replace: true })
    } catch (requestError) {
      setError(requestError?.message || 'Unable to upload this prescription. Retrying will safely reuse the same request key.')
    } finally { setSaving(false) }
  }

  return <div className="customer-prescriptions-page">
    <header className="customer-prescriptions-header"><div><small>PRESCRIPTION UPLOAD</small><strong>{order?.orderNumber || 'Order prescription'}</strong></div><button type="button" onClick={() => navigate(`/app/orders/${orderId}`)}>Back</button></header>
    <main className="customer-prescriptions-main">
      {loading && <div className="customer-prescriptions-message"><strong>Loading upload…</strong></div>}
      {error && <div className="customer-prescriptions-message"><strong>Something needs attention</strong><span>{error}</span></div>}
      {order && <><section className="customer-prescription-hero"><span>{statusLabel(order.status)}</span><h1>{supersedesPrescriptionId ? 'Upload replacement.' : 'Upload prescription.'}</h1><p>PDF, JPEG, or PNG only. The pharmacy reviews the document; MediConnect does not provide medical advice.</p></section>
        <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>RX ITEMS</span><strong>{rxItems.length}</strong></div><div className="customer-prescriptions-items">{rxItems.map((item) => <article key={item.id}><strong>{item.medicineNameSnapshot}</strong><span>Quantity {item.quantity}</span></article>)}</div></section>
        {canUpload ? <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>SECURE DOCUMENT</span><strong>{supersedesPrescriptionId ? 'Replacement' : 'New upload'}</strong></div><form className="customer-prescription-form" onSubmit={upload}><label><span>Prescription document</span><input required type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={chooseFile}/></label>{file && <p className="customer-prescriptions-copy">Selected: {file.name}</p>}<button type="submit" disabled={saving || !file}>{saving ? 'Uploading securely…' : 'Upload for pharmacist review'}</button></form></section> : <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>UPLOAD STATE</span><strong>Closed</strong></div><p className="customer-prescriptions-copy">Upload is available only while this prescription order is pending review.</p></section>}
        {prescriptions.length > 0 && <section className="customer-prescriptions-panel"><div className="customer-prescriptions-panel-head"><span>ORDER HISTORY</span><strong>{prescriptions.length}</strong></div><div className="customer-prescriptions-history">{prescriptions.map((item) => <article key={item.id}><strong>{statusLabel(item.status)}</strong><span>{item.originalFilename || 'Prescription document'}</span></article>)}</div></section>}
      </>}
    </main>
  </div>
}
