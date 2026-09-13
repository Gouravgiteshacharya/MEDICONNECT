import { useNavigate } from 'react-router-dom'

import { usePharmacyContext } from './pharmacyWorkspace'

export default function PharmacyOrders() {
  const navigate = useNavigate()
  const { pathWithPharmacy } = usePharmacyContext()

  function openOrder(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const orderId = String(formData.get('orderId') ?? '').trim()

    if (orderId) {
      navigate(pathWithPharmacy(`/pharmacy/orders/${orderId}`))
    }
  }

  return (
    <main className="pharmacy-page">
      <header className="pharmacy-page-header">
        <div>
          <span>ORDERS</span>
          <h1>Order operations</h1>
          <p>
            The backend currently exposes pharmacy order decision actions for a
            known order ID, but not a pharmacy order list or order detail API.
          </p>
        </div>
      </header>

      <section className="pharmacy-blocked">
        <strong>Order queue is blocked by backend API coverage.</strong>
        <p>
          A dashboard queue, order list, and pharmacy order detail endpoint are
          needed before this can become a full operational order page.
        </p>
      </section>

      <form className="pharmacy-form-panel" onSubmit={openOrder}>
        <h2>Open known order decision</h2>
        <p>
          Use this only when another supported flow provides the order ID.
        </p>
        <div className="pharmacy-form-grid">
          <label>
            <span>Order ID</span>
            <input
              required
              name="orderId"
              placeholder="Order UUID"
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
