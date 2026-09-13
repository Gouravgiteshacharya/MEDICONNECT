import { useNavigate } from 'react-router-dom'

const capabilities = [
  {
    area: 'Dispatch',
    support: 'Action supported',
    detail: 'POST /api/v1/dispatch/orders/:orderId',
    path: '/admin/orders',
  },
  {
    area: 'Delivery batches',
    support: 'Actions supported',
    detail: 'POST /api/v1/delivery-batches/evaluate and /:batchId/optimize',
    path: '/admin/deliveries',
  },
  {
    area: 'Support',
    support: 'Blocked by backend',
    detail: 'SupportTicket and SupportMessage models exist, but no routes are mounted.',
    path: '/admin/support',
  },
  {
    area: 'Risk',
    support: 'Blocked by backend',
    detail: 'RiskAssessment model exists, but no routes are mounted.',
    path: '/admin/risk',
  },
]

export default function AdminOverview() {
  const navigate = useNavigate()

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <span>MEDICONNECT OPERATIONS</span>
          <h1>Admin overview</h1>
          <p>
            This workspace exposes only real operations capabilities available
            in the current backend. Missing queues are marked as backend-blocked.
          </p>
        </div>
      </header>

      <section className="admin-grid admin-metrics">
        <article className="admin-card">
          <small>ORDER DISPATCH</small>
          <strong>Available</strong>
          <p>Dispatch can be triggered for a known delivery order ID.</p>
        </article>
        <article className="admin-card">
          <small>BATCH EVALUATION</small>
          <strong>Available</strong>
          <p>Compatible delivery batches can be evaluated from order IDs.</p>
        </article>
        <article className="admin-card">
          <small>SUPPORT QUEUE</small>
          <strong>Blocked</strong>
          <p>No support ticket routes are currently mounted.</p>
        </article>
        <article className="admin-card">
          <small>RISK QUEUE</small>
          <strong>Blocked</strong>
          <p>No risk assessment routes are currently mounted.</p>
        </article>
      </section>

      <section className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Area</th>
              <th>Status</th>
              <th>Backend capability</th>
              <th>Workspace</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((item) => (
              <tr key={item.area}>
                <td>
                  <strong>{item.area}</strong>
                </td>
                <td>
                  <span
                    className={
                      item.support.includes('Blocked')
                        ? 'admin-badge warning'
                        : 'admin-badge'
                    }
                  >
                    {item.support}
                  </span>
                </td>
                <td>{item.detail}</td>
                <td>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    onClick={() => navigate(item.path)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
