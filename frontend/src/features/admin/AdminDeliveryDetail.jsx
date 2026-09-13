import { useParams } from 'react-router-dom'

export default function AdminDeliveryDetail() {
  const { deliveryId } = useParams()

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>DELIVERY DETAIL</span>
          <h1>Timeline blocked</h1>
          <p>
            Delivery reference {deliveryId} cannot be loaded because no admin
            delivery detail API is currently mounted.
          </p>
        </div>
      </header>

      <section className="admin-blocked">
        <strong>Delivery detail is blocked by backend API coverage.</strong>
        <p>
          A real endpoint should expose assignment status, dispatch attempts,
          delivery events, rider linkage, and timestamps before this page shows
          an operational timeline.
        </p>
      </section>
    </main>
  )
}
