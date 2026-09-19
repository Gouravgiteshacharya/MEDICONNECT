import { Link } from 'react-router-dom'
import Seo from '../components/Seo'
import './LegalPage.css'

export default function TermsPage() {
  return (
    <div className="legal-page">
      <Seo title="Terms & Conditions — MediConnect" description="Terms for customers, participating pharmacies, and delivery partners using the MediConnect marketplace." path="/terms" />
      <header className="legal-header">
        <Link className="legal-brand" to="/"><span>M</span><strong>MediConnect</strong></Link>
        <Link className="legal-home-link" to="/">Back to home</Link>
      </header>
      <main className="legal-content">
        <small>TERMS &amp; CONDITIONS · LAST UPDATED 19 SEPTEMBER 2026</small>
        <h1>Using MediConnect</h1>
        <p className="legal-lead">These terms describe the current MediConnect marketplace. They are product terms intended for owner and legal review before launch and are not legal advice.</p>

        <section><h2>Marketplace role</h2><p>MediConnect connects customers with participating local pharmacies. The selected pharmacy is the seller and fulfiller of medicines. MediConnect provides discovery, ordering, coordination, and operational tools but does not replace the professional responsibilities of a pharmacist or healthcare professional.</p></section>

        <section><h2>Medicines and prescriptions</h2><p>Prescription-required medicines are supplied only after pharmacy review of a valid prescription. MediConnect does not diagnose conditions, prescribe medicines, recommend dosage, or provide emergency medical advice. Seek qualified medical help for clinical decisions or emergencies.</p></section>

        <section><h2>Availability, pricing, pickup, and delivery</h2><p>Medicine availability can change. Prices, quantities, and fulfilment options are confirmed using the current platform state when an order is placed. Depending on available options, customers may select pharmacy pickup or delivery. Estimates are not guarantees and may be affected by pharmacy operations, verification, stock, distance, or delivery conditions.</p></section>

        <section><h2>Orders, cancellation, and refunds</h2><p>Orders may be cancelled only when the application presents a cancellation option under the implemented order policy. Any refund or payment handling applies only where the platform expressly offers and confirms it; these terms do not create payment or refund functionality that is not present in the service.</p></section>

        <section><h2>Accounts and acceptable use</h2><p>You must provide accurate information, protect your credentials, and promptly report suspected unauthorized access. You must not impersonate another person, submit fraudulent prescriptions or partner documents, probe or disrupt the service, automate abusive requests, evade access controls, or use MediConnect for unlawful activity.</p></section>

        <section><h2>Pharmacy partner responsibilities</h2><p>Pharmacy partners are responsible for accurate licensing and business information, lawful sale and fulfilment, current inventory and pricing information, appropriate prescription review, safe handling, and authorized staff access. Approval may require document review and a field visit.</p></section>

        <section><h2>Rider partner responsibilities</h2><p>Rider partners are responsible for accurate identity, address, vehicle, and licence information; successful mandatory offline verification; safe and lawful delivery activity; appropriate handling of orders; and protection of customer information encountered during delivery.</p></section>

        <section><h2>Site content and intellectual property</h2><p>MediConnect branding, software, interface content, and original materials may be used only for accessing the service as intended. Third-party names and content remain the property of their respective owners. You may not copy, resell, reverse engineer, or misuse protected parts of the service except where applicable law permits.</p></section>

        <section><h2>Suspension and termination</h2><p>Access may be limited, suspended, or terminated to protect users, comply with requirements, investigate misuse, address inaccurate partner information, or maintain service integrity. Users may stop using the service at any time, subject to unresolved orders or obligations.</p></section>

        <section><h2>Service limitations</h2><p>MediConnect depends on participating pharmacies, riders, networks, mapping, storage, and hosting providers. To the extent permitted by applicable law, MediConnect is not responsible for independent professional decisions, partner conduct, unavoidable outages, or losses caused by inaccurate information supplied by users or partners. Nothing here excludes rights or responsibilities that cannot lawfully be excluded.</p></section>

        <section><h2>Contact and changes</h2><p>Questions may be sent through the support channel provided in the application. We may update these terms as the service changes and will publish the current version here with an updated date.</p></section>
      </main>
    </div>
  )
}

