import { Link } from 'react-router-dom'
import Seo from '../components/Seo'
import './LegalPage.css'

export default function NotFoundPage() {
  return (
    <main className="not-found-page">
      <Seo title="Page Not Found — MediConnect" description="The requested MediConnect page could not be found." path={window.location.pathname} noIndex />
      <section className="not-found-card">
        <div className="not-found-mark" aria-hidden="true">M</div>
        <small>404</small>
        <h1>Page not found</h1>
        <p>The page may have moved or the address may be incorrect. Return home or continue to medicine search.</p>
        <div className="not-found-actions">
          <Link to="/">Back to MediConnect</Link>
          <Link to="/app/search">Search medicines</Link>
        </div>
      </section>
    </main>
  )
}
