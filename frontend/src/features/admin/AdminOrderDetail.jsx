import { useParams } from 'react-router-dom'

export default function AdminOrderDetail() {
  const { orderId } = useParams()

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>ORDER DETAIL</span>
          <h1>Read-only detail blocked</h1>
          <p>
            Order ID {orderId} can be used for supported admin actions, but the
            backend does not expose an admin order detail endpoint.
          </p>
        </div>
      </header>

      <section className="admin-blocked">
        <strong>Admin order detail is blocked by backend API coverage.</strong>
        <p>
          The customer order detail endpoint is customer-scoped and must not be
          reused for internal operations.
        </p>
      </section>
    </main>
  )
}
