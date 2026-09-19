import { Link } from 'react-router-dom'
import Seo from '../components/Seo'
import './LegalPage.css'

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <Seo title="Privacy Policy — MediConnect" description="How MediConnect handles customer, pharmacy partner, rider partner, location, order, and private document information." path="/privacy" />
      <header className="legal-header">
        <Link className="legal-brand" to="/"><span>M</span><strong>MediConnect</strong></Link>
        <Link className="legal-home-link" to="/">Back to home</Link>
      </header>
      <main className="legal-content">
        <small>PRIVACY NOTICE · LAST UPDATED 19 SEPTEMBER 2026</small>
        <h1>Privacy at MediConnect</h1>
        <p className="legal-lead">This notice explains the categories of information MediConnect handles to connect customers with participating pharmacies and delivery partners. It is product information, not a claim of legal certification.</p>

        <section><h2>Information we handle</h2><ul>
          <li><strong>Customers:</strong> account and contact details, saved delivery addresses, destination or location coordinates, medicine searches, cart and order information, prescription documents, and delivery activity.</li>
          <li><strong>Pharmacy applicants and partners:</strong> contact and business details, licence information, pharmacy address and coordinates, onboarding photos, geolocation captured during application, and field-visit or verification records.</li>
          <li><strong>Rider applicants and partners:</strong> contact and address details, vehicle and licence information, and office-verification records.</li>
          <li><strong>Operations:</strong> authentication and security records, support information, and operational records needed to run and protect the service.</li>
        </ul></section>

        <section><h2>How we use information</h2><p>We use information to create and secure accounts, find pharmacies near a selected destination, display current medicine availability, process and fulfil orders, support pickup or delivery, review prescriptions, assess partner applications, conduct required verification, prevent misuse, troubleshoot the service, and provide support.</p></section>

        <section><h2>Private documents</h2><p>Prescription documents and pharmacy onboarding photos are treated as private service records. They are stored in private storage and access is granted only to authorized users through time-limited access links. Do not upload information that is not required for the relevant review.</p></section>

        <section><h2>Location information</h2><p>MediConnect uses a customer-selected destination or coordinates to find nearby pharmacies and estimate service options. Pharmacy applicants provide coordinates and may capture browser geolocation for field verification. Riders may provide location updates needed for active delivery operations. Browser location requires permission where the browser requests it.</p></section>

        <section><h2>Service providers</h2><p>We use infrastructure and service providers for application hosting, database and private file storage, mapping and place selection, and related technical operations. These providers process information only as needed to provide those services under their own applicable terms and safeguards.</p></section>

        <section><h2>Security and retention</h2><p>We apply access controls, encrypted transport, private storage, short-lived document links, password hashing, and role-based authorization. No system is completely risk-free. We retain information only for as long as reasonably needed for service delivery, security, dispute handling, operational integrity, and applicable obligations, then delete or de-identify it when appropriate.</p></section>

        <section><h2>Your choices and rights</h2><p>You can review or update supported account details in the application. For other access, correction, deletion, objection, or privacy questions, contact MediConnect through the support channel provided in the application. A request may require identity verification, and some records may need to be retained for legitimate operational or legal reasons.</p></section>

        <section><h2>Updates</h2><p>We may update this notice as the product, providers, or requirements change. The latest version will be posted here with a revised update date.</p></section>
      </main>
    </div>
  )
}

