import { useNavigate } from 'react-router-dom'

import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyPrescriptions() {
  const navigate = useNavigate()
  const { pathWithPharmacy } = usePharmacyContext()

  function openPrescription(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const prescriptionId = String(formData.get('prescriptionId') ?? '').trim()

    if (prescriptionId) {
      navigate(pathWithPharmacy(`/pharmacy/prescriptions/${prescriptionId}`))
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>PRESCRIPTIONS</span>
          <h1>Prescription review</h1>
          <p>
            The backend exposes prescription review for a known prescription ID,
            but not a pharmacy prescription queue or detail read endpoint.
          </p>
        </div>
      </header>

      <section className="pharmacy-blocked">
        <strong>Review queue is blocked by backend API coverage.</strong>
        <p>
          A pharmacy-scoped prescription list/detail endpoint is needed before
          this can show pending review work from backend data.
        </p>
      </section>

      <form className="pharmacy-form-panel" onSubmit={openPrescription}>
        <h2>Open known prescription review</h2>
        <p>
          Use this only when another supported flow provides the prescription
          ID.
        </p>
        <div className="pharmacy-form-grid">
          <label>
            <span>Prescription ID</span>
            <input
              required
              name="prescriptionId"
              placeholder="Prescription UUID"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="pharmacy-button">
            Open
          </button>
        </div>
      </form>
    </main>
  )
}
