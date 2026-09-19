import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  approvePartnerApplication,
  formatAdminDate,
  getPartnerApplication,
  getPharmacyApplicationPhotoAccess,
  labelFromEnum,
  recordPartnerVerification,
  transitionPartnerApplication,
} from './adminService'
import './AdminPartnerApplications.css'

function Detail({ label, value }) {
  return <div><small>{label}</small><strong>{value ?? 'Not provided'}</strong></div>
}

export default function AdminPartnerApplicationDetail({ type }) {
  const { applicationId } = useParams()
  const navigate = useNavigate()
  const pharmacy = type === 'pharmacies'
  const [application, setApplication] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('PENDING')
  const [temporaryCredential, setTemporaryCredential] = useState('')

  async function load() {
    try {
      const response = await getPartnerApplication(type, applicationId)
      setApplication(response.application)
      setError('')
    } catch (requestError) { setError(requestError.message) }
  }

  useEffect(() => { load() }, [applicationId, type])

  async function transition(status) {
    const reason = status === 'REJECTED' ? window.prompt('Enter the rejection reason') : undefined
    if (status === 'REJECTED' && !reason) return
    try { await transitionPartnerApplication(type, applicationId, { status, ...(reason ? { reason } : {}) }); await load() }
    catch (requestError) { setError(requestError.message) }
  }

  async function recordVerification() {
    const completed = result === 'PASSED'
    const body = pharmacy
      ? { visitedAt: completed ? new Date().toISOString() : undefined, notes: notes || undefined, checklist: {}, result }
      : { verifiedAt: completed ? new Date().toISOString() : undefined, notes: notes || undefined, checklist: {}, result }
    try { await recordPartnerVerification(type, applicationId, body); await load() }
    catch (requestError) { setError(requestError.message) }
  }

  async function approve() {
    try {
      const response = await approvePartnerApplication(type, applicationId)
      setTemporaryCredential(response.temporaryCredential)
      await load()
    } catch (requestError) { setError(requestError.message) }
  }

  async function openPhoto() {
    try {
      const response = await getPharmacyApplicationPhotoAccess(applicationId)
      window.open(response.documentAccess.url, '_blank', 'noopener,noreferrer')
    } catch (requestError) { setError(requestError.message) }
  }

  if (!application) return <main className="admin-partner-page"><p>{error || 'Loading application…'}</p></main>
  const status = application.status
  const pendingVerification = pharmacy ? status === 'FIELD_VISIT_PENDING' : status === 'OFFICE_VERIFICATION_PENDING'
  const verificationComplete = pharmacy ? status === 'FIELD_VISIT_COMPLETED' : status === 'OFFICE_VERIFICATION_COMPLETED'

  return (
    <main className="admin-partner-page admin-partner-detail">
      <button className="admin-partner-back" onClick={() => navigate(`/admin/applications/${type}`)}>← Back to applications</button>
      <header><div><small>{labelFromEnum(status)}</small><h1>{pharmacy ? application.pharmacyName : application.fullName}</h1><p>Submitted {formatAdminDate(application.submittedAt)}</p></div></header>
      {error && <p className="admin-partner-error">{error}</p>}
      <section className="admin-partner-details">
        <Detail label="Contact" value={pharmacy ? application.contactName : application.fullName} /><Detail label="Email" value={pharmacy ? application.contactEmail : application.email} /><Detail label="Phone" value={application.phone} /><Detail label="Location" value={`${application.city}, ${application.state} ${application.postalCode}`} />
        {pharmacy ? <><Detail label="Licence" value={application.licenseNumber} /><Detail label="Submitted coordinates" value={`${application.latitude}, ${application.longitude}`} /><Detail label="Browser location captured" value={formatAdminDate(application.locationCapturedAt)} /><Detail label="Photo uploaded" value={formatAdminDate(application.photoUploadedAt)} /><Detail label="Operating information" value={application.operatingInfo} /><Detail label="Pickup available" value={application.pickupAvailable ? 'Yes' : 'No'} /></> : <><Detail label="Vehicle" value={`${labelFromEnum(application.vehicleType)} ${application.vehicleNumber || ''}`} /><Detail label="Driving licence" value={application.drivingLicenseNumber} /><Detail label="Identity reference" value={application.identityDocumentReference} /><Detail label="Emergency contact" value={application.emergencyContact} /></>}
      </section>
      {pharmacy && <button className="admin-partner-action secondary" onClick={openPhoto}>Open private pharmacy photo</button>}
      <section className="admin-partner-workflow"><h2>Verification workflow</h2><div className="admin-partner-actions">
        {status === 'APPLICATION_SUBMITTED' && <button onClick={() => transition('DOCUMENT_REVIEW')}>Start document review</button>}
        {status === 'DOCUMENT_REVIEW' && <button onClick={() => transition(pharmacy ? 'FIELD_VISIT_PENDING' : 'OFFICE_VERIFICATION_PENDING')}>{pharmacy ? 'Mark field visit pending' : 'Mark office verification pending'}</button>}
        {!['APPROVED','REJECTED'].includes(status) && <button className="danger" onClick={() => transition('REJECTED')}>Reject application</button>}
      </div>
      {pendingVerification && <div className="admin-partner-verification"><label>Result<select value={result} onChange={(event) => setResult(event.target.value)}><option>PENDING</option><option>PASSED</option><option>FAILED</option><option>NEEDS_FOLLOW_UP</option></select></label><label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button onClick={recordVerification}>Record {pharmacy ? 'field visit' : 'office verification'}</button></div>}
      {verificationComplete && <button className="admin-partner-action" onClick={approve}>Approve and create partner account</button>}
      </section>
      {temporaryCredential && <section className="admin-temporary-credential"><strong>Temporary MVP credential — show once and transfer securely</strong><code>{temporaryCredential}</code><p>This value is not stored in plaintext and will disappear when you leave this page.</p></section>}
    </main>
  )
}
