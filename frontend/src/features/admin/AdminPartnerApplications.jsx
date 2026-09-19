import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatAdminDate, labelFromEnum, listPartnerApplications } from './adminService'
import './AdminPartnerApplications.css'

export default function AdminPartnerApplications({ type }) {
  const navigate = useNavigate()
  const [applications, setApplications] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const pharmacy = type === 'pharmacies'

  useEffect(() => {
    let current = true
    listPartnerApplications(type, { status: status || undefined })
      .then((result) => current && setApplications(result.applications || []))
      .catch((requestError) => current && setError(requestError.message))
    return () => { current = false }
  }, [status, type])

  return (
    <main className="admin-partner-page">
      <header><div><small>PARTNER ONBOARDING</small><h1>{pharmacy ? 'Pharmacy applications' : 'Rider applications'}</h1></div>
        <div className="admin-partner-tabs"><button className={pharmacy ? 'active' : ''} onClick={() => navigate('/admin/applications/pharmacies')}>Pharmacies</button><button className={!pharmacy ? 'active' : ''} onClick={() => navigate('/admin/applications/riders')}>Riders</button></div>
      </header>
      <label className="admin-partner-filter">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{(pharmacy
        ? ['APPLICATION_SUBMITTED','DOCUMENT_REVIEW','FIELD_VISIT_PENDING','FIELD_VISIT_COMPLETED','APPROVED','REJECTED']
        : ['APPLICATION_SUBMITTED','DOCUMENT_REVIEW','OFFICE_VERIFICATION_PENDING','OFFICE_VERIFICATION_COMPLETED','APPROVED','REJECTED']).map((value) => <option key={value} value={value}>{labelFromEnum(value)}</option>)}</select></label>
      {error && <p className="admin-partner-error">{error}</p>}
      <section className="admin-partner-list">
        {applications.map((application) => <button key={application.id} onClick={() => navigate(`/admin/applications/${type}/${application.id}`)}>
          <div><strong>{pharmacy ? application.pharmacyName : application.fullName}</strong><span>{pharmacy ? application.contactEmail : application.email}</span></div>
          <div><span>{application.city}, {application.state}</span><small>{formatAdminDate(application.submittedAt)}</small></div>
          <b>{labelFromEnum(application.status)}</b>
        </button>)}
        {!applications.length && !error && <p>No applications match this view.</p>}
      </section>
    </main>
  )
}
