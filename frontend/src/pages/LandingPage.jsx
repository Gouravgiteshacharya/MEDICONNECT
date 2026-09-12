import { useEffect, useState } from 'react'
import './landing.css'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const demoPharmacies = [
  { name: 'Sharma Medical Store', distance: '0.02 km', price: '₹32', status: 'In stock', tone: 'good' },
  { name: 'Health Point Pharmacy', distance: '0.50 km', price: '₹31', status: 'Low stock', tone: 'low' },
  { name: 'City Care Pharmacy', distance: '0.58 km', price: '₹30', status: 'In stock', tone: 'good' },
]

function LandingPage({
  authenticated,
  user,
  logout,
  openAuth,
  openSearch,
  heroSearchRef,
  showFloatingSearch,
  searchFlowOpen,
}) {
  const [fulfilmentPreview, setFulfilmentPreview] = useState('delivery')
  const [audience, setAudience] = useState('customers')
  const [activeDemo, setActiveDemo] = useState(null)
  const [activeNav, setActiveNav] = useState('')
  const [nearPageEnd, setNearPageEnd] = useState(false)

  const goToSection = (id, navName = '') => {
    const target = document.getElementById(id)

    if (!target) return

    if (navName) {
      setActiveNav(navName)
    }

    const nav = document.querySelector('.mc-nav')
    const offset = (nav?.offsetHeight ?? 76) + 26

    const targetY =
      target.getBoundingClientRect().top +
      window.scrollY -
      offset

    window.scrollTo({
      top: targetY,
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    const sections = [
      ['mc-journey-section', 'how'],
      ['mc-live-section', 'medicines'],
      ['mc-network-section', 'pharmacies'],
    ]

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top) -
              Math.abs(b.boundingClientRect.top),
          )

        if (!visible.length) return

        const match = sections.find(
          ([id]) => id === visible[0].target.id,
        )

        if (match) {
          setActiveNav(match[1])
        }
      },
      {
        rootMargin: '-18% 0px -62% 0px',
        threshold: 0,
      },
    )

    sections.forEach(([id]) => {
      const element = document.getElementById(id)

      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [])


  useEffect(() => {
    const finalSection = document.getElementById('mc-final-section')
    const footer = document.getElementById('mc-footer')

    const endObserver = new IntersectionObserver(
      (entries) => {
        setNearPageEnd(entries.some((entry) => entry.isIntersecting))
      },
      {
        threshold: 0.15,
      },
    )

    if (finalSection) endObserver.observe(finalSection)
    if (footer) endObserver.observe(footer)

    return () => endObserver.disconnect()
  }, [])

  useEffect(() => {
    const elements = document.querySelectorAll('.mc-reveal')

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('mc-reveal-visible')
            revealObserver.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -8% 0px',
      },
    )

    elements.forEach((element) => revealObserver.observe(element))

    return () => revealObserver.disconnect()
  }, [audience])


  return (
    <div className={`mc-landing audience-${audience}`}>
      <header className="mc-nav">
        <button className="mc-brand" type="button" aria-label="MediConnect home">
          <span className="mc-logo">M</span>

          <span className="mc-brand-copy">
            <strong>MediConnect</strong>
            <small>Local pharmacies. Connected.</small>
          </span>
        </button>

        <nav className="mc-nav-links">
          <button
            className={activeNav === 'how' ? 'active' : ''}
            type="button"
            onClick={() => goToSection('mc-journey-section', 'how')}
          >
            <span>How it works</span>
          </button>

          <button
            className={activeNav === 'medicines' ? 'active' : ''}
            type="button"
            onClick={() => goToSection('mc-live-section', 'medicines')}
          >
            <span>Medicines</span>
          </button>

          <button
            className={activeNav === 'pharmacies' ? 'active' : ''}
            type="button"
            onClick={() => goToSection('mc-network-section', 'pharmacies')}
          >
            <span>Pharmacies</span>
          </button>

          <span className="mc-nav-divider" />

          <div className="mc-nav-audience">
            <button
              className={audience === 'customers' ? 'audience-active' : ''}
              type="button"
              onClick={() => {
                setAudience('customers')
                goToSection('mc-audience-section')
              }}
            >
              <span>For customers</span>
            </button>

            <button
              className={audience === 'pharmacies' ? 'audience-active' : ''}
              type="button"
              onClick={() => {
                setAudience('pharmacies')
                goToSection('mc-audience-section')
              }}
            >
              <span>For pharmacies</span>
            </button>
          </div>
        </nav>

        <div className="mc-nav-actions">
          <button className="mc-location" type="button" onClick={openSearch}>
            <PinIcon />
            <span>Brahmapur</span>
          </button>

          {authenticated ? (
            <>
              <span className="mc-user">
                Hi, {user?.name?.split(' ')[0]}
              </span>

              <button className="mc-login" type="button" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button className="mc-login" type="button" onClick={() => openAuth('login')}>
                Log in
              </button>

              <button className="mc-signup" type="button" onClick={() => openAuth('register')}>
                Sign up
              </button>
            </>
          )}
        </div>
      </header>

      <main className="mc-main">
        <section className="mc-hero">
          <div className="mc-hero-copy">
            <span className="mc-eyebrow">
              LOCAL PHARMACIES. CONNECTED.
            </span>

            <h1 className="mc-product-title">
              MEDICONNECT
            </h1>

            <h2 className="mc-product-subtitle">
              Your medicine. <em>Found.</em>
            </h2>

            <p>
              See which nearby pharmacies have your medicine, compare your options,
              and choose pickup or delivery.
            </p>

            <button
              ref={heroSearchRef}
              className="mc-hero-search"
              type="button"
              onClick={openSearch}
            >
              <span className="mc-search-icon">
                <SearchIcon />
              </span>

              <span className="mc-search-copy">
                <small>What medicine are you looking for?</small>
                <strong>Search medicines nearby...</strong>
              </span>

              <span className="mc-search-arrow">
                <ArrowIcon />
              </span>
            </button>

            <div className="mc-search-suggestions">
              <span>Popular</span>

              {['Dolo 650', 'Crocin', 'Azithral', 'Paracetamol'].map((item) => (
                <button key={item} type="button" onClick={openSearch}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mc-mobile-hero-preview">
            <div className="mc-mobile-preview-head">
              <div>
                <small>NEARBY AVAILABILITY</small>
                <strong>Dolo 650</strong>
              </div>

              <span>3 nearby</span>
            </div>

            <div className="mc-mobile-preview-result">
              <span className="mc-stock-dot good" />

              <div>
                <strong>City Care Pharmacy</strong>
                <small>0.58 km away · In stock</small>
              </div>

              <b>₹30</b>
            </div>
          </div>

          <div className="mc-hero-demo" aria-hidden="true">
            <div className="mc-demo-device">
              <div className="mc-device-top">
                <span className="mc-device-logo">M</span>

                <div className="mc-device-brand-copy">
                  <strong>MediConnect</strong>
                  <small>Medicine search</small>
                </div>
              </div>

              <div className="mc-device-search">
                <SearchIcon />
                <span>Dolo 650</span>
              </div>

              <div className="mc-device-label">
                3 pharmacies nearby
              </div>

              {demoPharmacies.map((pharmacy, index) => (
                <div
                  className={`mc-device-result ${
                    activeDemo === index ? 'active' : ''
                  }`}
                  key={pharmacy.name}
                >
                  <span className={`mc-stock-dot ${pharmacy.tone}`} />

                  <div>
                    <strong>{pharmacy.name}</strong>
                    <small>{pharmacy.distance} · {pharmacy.status}</small>
                  </div>

                  <b>{pharmacy.price}</b>
                </div>
              ))}

              <div className="mc-device-actions">
                <div
                  className={`mc-device-action ${
                    activeDemo === 'rx' ? 'active' : ''
                  }`}
                >
                  <span className="mc-action-icon">Rx</span>
                  <div>
                    <strong>Prescription</strong>
                    <small>Upload if required</small>
                  </div>
                </div>

                <div
                  className={`mc-device-action ${
                    activeDemo === 'delivery' ? 'active' : ''
                  }`}
                >
                  <span className="mc-action-icon">→</span>
                  <div>
                    <strong>Pickup / Delivery</strong>
                    <small>Choose fulfilment</small>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`mc-floating-card mc-floating-a ${
                activeDemo === 0 ? 'active' : ''
              }`}
              onMouseEnter={() => setActiveDemo(0)}
              onMouseLeave={() => setActiveDemo(null)}
            >
              <span className="mc-stock-dot good" />

              <div>
                <strong>Available nearby</strong>
                <small>Sharma Medical · In stock</small>
              </div>

              <span className="mc-callout-link" />
            </div>

            <div
              className={`mc-floating-card mc-floating-b ${
                activeDemo === 1 ? 'active' : ''
              }`}
              onMouseEnter={() => setActiveDemo(1)}
              onMouseLeave={() => setActiveDemo(null)}
            >
              <span className="mc-callout-symbol">₹</span>

              <div>
                <strong>Compare prices</strong>
                <small>₹30 – ₹32 nearby</small>
              </div>

              <span className="mc-callout-link" />
            </div>

            <div
              className={`mc-floating-card mc-floating-c ${
                activeDemo === 'rx' ? 'active' : ''
              }`}
              onMouseEnter={() => setActiveDemo('rx')}
              onMouseLeave={() => setActiveDemo(null)}
            >
              <span className="mc-mini-check">
                <CheckIcon />
              </span>

              <div>
                <strong>Prescription ready</strong>
                <small>Upload and verify when needed</small>
              </div>

              <span className="mc-callout-link" />
            </div>

            <div
              className={`mc-floating-card mc-floating-d ${
                activeDemo === 'delivery' ? 'active' : ''
              }`}
              onMouseEnter={() => setActiveDemo('delivery')}
              onMouseLeave={() => setActiveDemo(null)}
            >
              <span className="mc-callout-symbol">→</span>

              <div>
                <strong>Pickup or delivery</strong>
                <small>Choose what works for you</small>
              </div>

              <span className="mc-callout-link" />
            </div>

            <div
              className={`mc-floating-card mc-floating-c ${
                activeDemo === 'rx' ? 'active' : ''
              }`}
              onMouseEnter={() => setActiveDemo('rx')}
              onMouseLeave={() => setActiveDemo(null)}
            >
              <span className="mc-mini-check">
                <CheckIcon />
              </span>

              <div>
                <strong>Prescription ready</strong>
                <small>Continue securely</small>
              </div>
            </div>
          </div>
        </section>

        <section className="mc-bento mc-reveal">
          <button className="mc-bento-card mc-yellow" type="button" onClick={openSearch}>
            <span className="mc-card-number">01</span>

            <div>
              <h2>Find it nearby</h2>
              <p>See which nearby pharmacies have your medicine right now.</p>
            </div>

            <ArrowIcon />
          </button>

          <button className="mc-bento-card mc-mint" type="button" onClick={openSearch}>
            <span className="mc-card-number">02</span>

            <div>
              <h2>Compare your options</h2>
              <p>Compare price, distance and availability before you choose.</p>
            </div>

            <ArrowIcon />
          </button>

          <button className="mc-bento-card mc-pink" type="button" onClick={openSearch}>
            <div className="mc-fulfilment-ghost" aria-hidden="true">
              <span>Pickup</span>

              <div className="mc-fulfilment-switch">
                <i />
              </div>

              <span>Delivery</span>
            </div>

            <div>
              <h2>Pickup or delivery</h2>
              <p>Pick it up yourself or have it brought to you.</p>
            </div>

            <ArrowIcon />
          </button>

          <button className="mc-bento-card mc-blue" type="button" onClick={openSearch}>
            <span className="mc-card-number">04</span>

            <div>
              <h2>Prescription? Handled.</h2>
              <p>Upload it when required and let the pharmacy verify it.</p>
            </div>

            <ArrowIcon />
          </button>
        </section>

        <section className="mc-audience mc-reveal" id="mc-audience-section">
          <div className="mc-audience-head">
            <div className="mc-audience-copy">
              <span>CHOOSE YOUR MEDICONNECT VIEW</span>

              <h2>
                {audience === 'customers'
                  ? 'Find the medicine you need, right around you.'
                  : 'Bring your local pharmacy into the network.'}
              </h2>

              <p>
                {audience === 'customers'
                  ? 'Search nearby availability, compare pharmacies, handle prescriptions when needed, and choose pickup or delivery.'
                  : 'Make your inventory discoverable, receive local customer demand, manage orders, and review prescription-required requests.'}
              </p>
            </div>

            <div className="mc-audience-toggle">
              <button
                className={audience === 'customers' ? 'active' : ''}
                type="button"
                onClick={() => setAudience('customers')}
              >
                For customers
              </button>

              <button
                className={audience === 'pharmacies' ? 'active' : ''}
                type="button"
                onClick={() => setAudience('pharmacies')}
              >
                For pharmacies
              </button>
            </div>
          </div>

          <div
            key={audience}
            className={`mc-audience-experience mc-audience-${audience}`}
          >
            {audience === 'customers' ? (
              <>
                <div className="mc-audience-benefits">
                  <article>
                    <span>⌕</span>
                    <div>
                      <strong>Find nearby stock</strong>
                      <small>See which local pharmacies have what you need.</small>
                    </div>
                  </article>

                  <article>
                    <span>₹</span>
                    <div>
                      <strong>Compare before choosing</strong>
                      <small>Check availability, distance and price together.</small>
                    </div>
                  </article>

                  <article>
                    <span>Rx</span>
                    <div>
                      <strong>Prescription support</strong>
                      <small>Upload when required and continue the order.</small>
                    </div>
                  </article>

                  <article>
                    <span>→</span>
                    <div>
                      <strong>Pickup or delivery</strong>
                      <small>Choose how you want to receive the medicine.</small>
                    </div>
                  </article>
                </div>

                <div className="mc-audience-preview mc-customer-preview">
                  <div className="mc-preview-top">
                    <div>
                      <small>CUSTOMER VIEW</small>
                      <strong>Dolo 650 nearby</strong>
                    </div>

                    <span>3 pharmacies</span>
                  </div>

                  <div className="mc-customer-preview-search">
                    <SearchIcon />
                    <span>Dolo 650</span>
                  </div>

                  <div className="mc-customer-preview-row">
                    <i className="good" />
                    <div>
                      <strong>City Care Pharmacy</strong>
                      <small>0.58 km · In stock</small>
                    </div>
                    <b>₹30</b>
                  </div>

                  <div className="mc-customer-preview-row">
                    <i />
                    <div>
                      <strong>Health Point Pharmacy</strong>
                      <small>0.50 km · Low stock</small>
                    </div>
                    <b>₹31</b>
                  </div>

                  <div className="mc-customer-preview-summary">
                    <article>
                      <small>Best price</small>
                      <strong>₹30</strong>
                      <span>City Care</span>
                    </article>

                    <article>
                      <small>Nearest</small>
                      <strong>0.50 km</strong>
                      <span>Health Point</span>
                    </article>

                    <article>
                      <small>Prescription</small>
                      <strong>Not needed</strong>
                      <span>For Dolo 650</span>
                    </article>
                  </div>

                  <div className="mc-customer-preview-footer">
                    <span>
                      <i className="good" />
                      Availability updated recently
                    </span>

                    <button type="button" onClick={openSearch}>
                      Search medicines nearby
                      <ArrowIcon />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mc-audience-benefits">
                  <article>
                    <span>◎</span>
                    <div>
                      <strong>Be discovered locally</strong>
                      <small>Appear when nearby customers search relevant medicines.</small>
                    </div>
                  </article>

                  <article>
                    <span>▦</span>
                    <div>
                      <strong>Keep inventory visible</strong>
                      <small>Maintain medicine availability and stock freshness.</small>
                    </div>
                  </article>

                  <article>
                    <span>↓</span>
                    <div>
                      <strong>Receive incoming orders</strong>
                      <small>See customer orders and fulfilment choices in one place.</small>
                    </div>
                  </article>

                  <article>
                    <span>Rx</span>
                    <div>
                      <strong>Review prescriptions</strong>
                      <small>Handle prescription-required requests before fulfilment.</small>
                    </div>
                  </article>
                </div>

                <div className="mc-audience-preview mc-pharmacy-preview">
                  <div className="mc-preview-top">
                    <div>
                      <small>PHARMACY VIEW</small>
                      <strong>Sharma Medical Store</strong>
                    </div>

                    <span className="mc-pharmacy-live">Live</span>
                  </div>

                  <div className="mc-pharmacy-preview-stats">
                    <article>
                      <small>Visible medicines</small>
                      <strong>248</strong>
                    </article>

                    <article>
                      <small>Orders today</small>
                      <strong>18</strong>
                    </article>

                    <article>
                      <small>Rx reviews</small>
                      <strong>4</strong>
                    </article>
                  </div>

                  <div className="mc-pharmacy-preview-feed">
                    <div>
                      <i className="good" />
                      <span>Dolo 650 inventory updated</span>
                      <small>2 min</small>
                    </div>

                    <div>
                      <i />
                      <span>New order received</span>
                      <small>5 min</small>
                    </div>

                    <div>
                      <i className="rx" />
                      <span>Prescription awaiting review</span>
                      <small>8 min</small>
                    </div>
                  </div>

                  <div className="mc-pharmacy-preview-inventory">
                    <div className="mc-pharmacy-preview-inventory-head">
                      <div>
                        <small>INVENTORY SNAPSHOT</small>
                        <strong>Popular medicines</strong>
                      </div>

                      <span>Live availability</span>
                    </div>

                    <div className="mc-pharmacy-inventory-row">
                      <div>
                        <i className="good" />
                        <span>Dolo 650</span>
                      </div>
                      <small>38 units</small>
                      <b>Available</b>
                    </div>

                    <div className="mc-pharmacy-inventory-row">
                      <div>
                        <i />
                        <span>Paracetamol 500</span>
                      </div>
                      <small>21 units</small>
                      <b>Available</b>
                    </div>

                    <div className="mc-pharmacy-inventory-row">
                      <div>
                        <i className="low" />
                        <span>Azithral 500</span>
                      </div>
                      <small>6 units</small>
                      <b>Low stock</b>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="mc-journey mc-reveal" id="mc-journey-section">
          <div className="mc-section-copy">
            <span>THE MEDICONNECT JOURNEY</span>

            <h2>From search to medicine, in one place.</h2>

            <p>
              MediConnect keeps the important steps connected, so you spend less
              time calling around and more time choosing what works for you.
            </p>
          </div>

          <div className="mc-journey-track mc-journey-connected">
            <div className="mc-journey-line" aria-hidden="true" />

            {[
              {
                number: '01',
                title: 'Search medicine',
                copy: 'Start with the medicine you need.',
                type: 'search',
              },
              {
                number: '02',
                title: 'Check nearby stock',
                copy: 'See availability around your location.',
                type: 'stock',
              },
              {
                number: '03',
                title: 'Compare pharmacies',
                copy: 'Check distance, price and stock status.',
                type: 'compare',
              },
              {
                number: '04',
                title: 'Choose fulfilment',
                copy: 'Pickup locally or continue to delivery.',
                type: 'fulfilment',
              },
            ].map(({ number, title, copy, type }) => (
              <article className="mc-journey-step" key={number}>
                <div className="mc-journey-marker">
                  <span>{number}</span>
                </div>

                <div className={`mc-journey-visual visual-${type}`}>
                  {type === 'search' && (
                    <>
                      <span className="mc-journey-search-icon">⌕</span>
                      <div>
                        <small>SEARCH</small>
                        <strong>Dolo 650</strong>
                      </div>
                    </>
                  )}

                  {type === 'stock' && (
                    <div className="mc-journey-stock-list">
                      <span><i className="good" /> Nearby · In stock</span>
                      <span><i className="low" /> 0.5 km · Low stock</span>
                    </div>
                  )}

                  {type === 'compare' && (
                    <div className="mc-journey-compare">
                      <span>
                        <small>City Care</small>
                        <strong>₹30</strong>
                      </span>

                      <span>
                        <small>Health Point</small>
                        <strong>₹31</strong>
                      </span>
                    </div>
                  )}

                  {type === 'fulfilment' && (
                    <div className="mc-journey-choice">
                      <span>Pickup</span>
                      <span>Delivery</span>
                    </div>
                  )}
                </div>

                <div className="mc-journey-step-copy">
                  <strong>{title}</strong>
                  <small>{copy}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mc-live mc-reveal" id="mc-live-section">
          <div className="mc-live-copy">
            <span>ONE SEARCH. YOUR OPTIONS.</span>

            <h2>Know before you go.</h2>

            <p>
              Availability, price and distance come together in one view, so the
              pharmacy visit starts with information instead of guesswork.
            </p>

            <div className="mc-live-points">
              <span>Fresh availability</span>
              <span>Distance-aware results</span>
              <span>Compare before choosing</span>
            </div>

            <button type="button" onClick={openSearch}>
              Search a medicine
              <ArrowIcon />
            </button>
          </div>

          <div className="mc-live-panel">
            <div className="mc-live-header">
              <div>
                <small>SEARCH RESULT</small>
                <strong>Dolo 650</strong>
              </div>

              <span>3 pharmacies nearby</span>
            </div>

            <div className="mc-live-summary">
              <article>
                <small>Best price</small>
                <strong>₹30</strong>
                <span>City Care</span>
              </article>

              <article>
                <small>Nearest</small>
                <strong>0.50 km</strong>
                <span>Health Point</span>
              </article>

              <article>
                <small>Availability</small>
                <strong>3 results</strong>
                <span>Updated recently</span>
              </article>
            </div>

            <div className="mc-live-results">
              {demoPharmacies.map((pharmacy, index) => (
                <article
                  className={`mc-live-row ${index === 0 ? 'best-match' : ''}`}
                  key={pharmacy.name}
                >
                  <div className="mc-pharmacy-avatar">
                    {pharmacy.name.charAt(0)}
                  </div>

                  <div className="mc-live-main">
                    <div className="mc-live-name-row">
                      <strong>{pharmacy.name}</strong>

                      {index === 0 && (
                        <span className="mc-best-match">Best match</span>
                      )}
                    </div>

                    <small>
                      {pharmacy.distance} away · {pharmacy.status}
                    </small>

                    <div className="mc-live-meta">
                      <span>
                        <i className={`mc-stock-dot ${pharmacy.tone}`} />
                        {pharmacy.status}
                      </span>

                      <span>Updated recently</span>
                    </div>
                  </div>

                  <div className="mc-live-price">
                    <small>From</small>
                    <b>{pharmacy.price}</b>
                  </div>

                  <button type="button" onClick={openSearch}>
                    View
                    <ArrowIcon />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mc-network mc-reveal" id="mc-network-section">
          <div className="mc-section-copy mc-network-copy">
            <span>THE “CONNECT” IN MEDICONNECT</span>

            <h2>The pharmacy network around you, connected.</h2>

            <p>
              One customer search can reach multiple nearby pharmacies while each
              pharmacy remains the seller of its medicine.
            </p>
          </div>

          <div className="mc-network-map">
            <svg
              className="mc-network-svg"
              viewBox="0 0 700 460"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className="mc-network-path path-1" d="M350 230 C270 180 205 120 110 90" />
              <path className="mc-network-path path-2" d="M350 230 C460 170 520 110 610 85" />
              <path className="mc-network-path path-3" d="M350 230 C260 290 205 340 105 370" />
              <path
                className="mc-network-path mobile-path-3"
                d="M350 230 C350 280 350 320 350 355"
              />
              <path className="mc-network-path path-4" d="M350 230 C455 285 525 345 615 370" />

              <circle className="mc-network-pulse pulse-1" r="4">
                <animateMotion dur="2.8s" repeatCount="indefinite" path="M350 230 C270 180 205 120 110 90" />
              </circle>

              <circle className="mc-network-pulse pulse-2" r="4">
                <animateMotion dur="3.1s" repeatCount="indefinite" path="M350 230 C460 170 520 110 610 85" />
              </circle>

              <circle className="mc-network-pulse pulse-3" r="4">
                <animateMotion dur="3.3s" repeatCount="indefinite" path="M350 230 C260 290 205 340 105 370" />
              </circle>

              <circle className="mc-network-pulse mobile-pulse-3" r="4">
                <animateMotion
                  dur="3.3s"
                  repeatCount="indefinite"
                  path="M350 230 C350 280 350 320 350 355"
                />
              </circle>

              <circle className="mc-network-pulse pulse-4" r="4">
                <animateMotion dur="3s" repeatCount="indefinite" path="M350 230 C455 285 525 345 615 370" />
              </circle>
            </svg>

            <div className="mc-network-center">
              <span>M</span>
              <small>MediConnect</small>
            </div>

            {[
              ['Sharma Medical', 'In stock'],
              ['City Care', 'Available'],
              ['Health Point', 'Low stock'],
              ['Local Pharmacy', 'Connected'],
            ].map(([name, status], index) => (
              <div
                className={`mc-network-node node-${index + 1}`}
                data-path={index + 1}
                key={name}
              >
                <span className={`mc-stock-dot ${status === 'Low stock' ? 'low' : 'good'}`} />

                <div>
                  <strong>{name}</strong>
                  <small>{status}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mc-prescription mc-reveal">
          <div className="mc-section-copy">
            <span>PRESCRIPTION MEDICINE</span>

            <h2>Prescription required? Keep going.</h2>

            <p>
              The prescription step is part of the order journey rather than a dead end.
            </p>
          </div>

          <div className="mc-rx-track mc-rx-flow">
            <div className="mc-rx-line" aria-hidden="true" />

            <article className="mc-rx-step">
              <span className="mc-rx-number">01</span>

              <div className="mc-rx-icon">Rx</div>

              <div className="mc-rx-state">
                <i className="uploaded" />
                Uploaded
              </div>

              <strong>Upload prescription</strong>

              <small>
                Add the prescription when the medicine requires one.
              </small>
            </article>

            <article className="mc-rx-step">
              <span className="mc-rx-number">02</span>

              <div className="mc-rx-icon">
                <CheckIcon />
              </div>

              <div className="mc-rx-state">
                <i className="review" />
                Under review
              </div>

              <strong>Pharmacy review</strong>

              <small>
                An authorized pharmacy professional reviews it before fulfilment.
              </small>
            </article>

            <article className="mc-rx-step">
              <span className="mc-rx-number">03</span>

              <div className="mc-rx-icon">
                <ArrowIcon />
              </div>

              <div className="mc-rx-state">
                <i className="approved" />
                Approved
              </div>

              <strong>Continue order</strong>

              <small>
                Once approved, continue to pickup or delivery.
              </small>
            </article>
          </div>
        </section>

        <section className="mc-fulfilment mc-reveal">
          <div className="mc-fulfilment-copy">
            <span>GET IT YOUR WAY</span>

            <h2>Pickup or delivery.</h2>

            <p>
              Choose the fulfilment option that works for you after selecting
              the pharmacy.
            </p>

            <div className="mc-toggle mc-fulfilment-toggle">
              <button
                className={fulfilmentPreview === 'pickup' ? 'active' : ''}
                type="button"
                onClick={() => setFulfilmentPreview('pickup')}
              >
                Pickup
              </button>

              <button
                className={fulfilmentPreview === 'delivery' ? 'active' : ''}
                type="button"
                onClick={() => setFulfilmentPreview('delivery')}
              >
                Delivery
              </button>
            </div>
          </div>

          <div
            key={fulfilmentPreview}
            className={`mc-fulfilment-stage ${fulfilmentPreview}`}
          >
            {fulfilmentPreview === 'pickup' ? (
              <>
                <div className="mc-pickup-scene">
                  <div className="mc-pickup-pharmacy">
                    <div className="mc-pickup-sign">PHARMACY</div>

                    <div className="mc-pickup-window">
                      <span>Reserved</span>
                      <strong>Dolo 650</strong>
                    </div>
                  </div>

                  <div className="mc-pickup-ready">
                    <span className="mc-ready-dot" />

                    <div>
                      <small>READY FOR PICKUP</small>
                      <strong>10–15 min</strong>
                    </div>
                  </div>
                </div>

                <div className="mc-fulfilment-details">
                  <span>PICKUP</span>

                  <h3>Reserve before you leave.</h3>

                  <p>
                    The pharmacy prepares your medicine and keeps it ready for
                    collection.
                  </p>

                  <div className="mc-fulfilment-info">
                    <article>
                      <small>Pharmacy</small>
                      <strong>City Care Pharmacy</strong>
                    </article>

                    <article>
                      <small>Distance</small>
                      <strong>0.58 km</strong>
                    </article>

                    <article>
                      <small>Ready in</small>
                      <strong>10–15 min</strong>
                    </article>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mc-delivery-scene">
                  <div className="mc-delivery-node">
                    <span>P</span>
                    <small>Pharmacy</small>
                  </div>

                  <div className="mc-delivery-line">
                    <i />
                  </div>

                  <div className="mc-delivery-rider">
                    <span>R</span>
                    <small>Rider</small>
                  </div>

                  <div className="mc-delivery-line">
                    <i />
                  </div>

                  <div className="mc-delivery-node">
                    <span>⌂</span>
                    <small>You</small>
                  </div>
                </div>

                <div className="mc-fulfilment-details">
                  <span>DELIVERY</span>

                  <h3>Track it to your door.</h3>

                  <p>
                    Continue from pharmacy confirmation into rider assignment,
                    pickup, and live delivery tracking.
                  </p>

                  <div className="mc-fulfilment-info">
                    <article>
                      <small>Pharmacy</small>
                      <strong>City Care Pharmacy</strong>
                    </article>

                    <article>
                      <small>ETA</small>
                      <strong>22–30 min</strong>
                    </article>

                    <article>
                      <small>Status</small>
                      <strong>Rider assigned</strong>
                    </article>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="mc-tracking mc-tracking-compact mc-reveal">
          <div className="mc-tracking-intro">
            <span>DELIVERY CONTINUES HERE</span>

            <h2>And you can follow it all the way.</h2>

            <p>
              After the pharmacy confirms the order, MediConnect keeps the delivery
              journey visible from preparation to arrival.
            </p>
          </div>

          <div className="mc-tracking-card mc-tracking-card-compact">
            <div className="mc-tracking-head">
              <div>
                <small>ORDER #MC4821</small>
                <strong>Dolo 650</strong>
              </div>

              <div className="mc-tracking-eta">
                <small>ESTIMATED ARRIVAL</small>
                <span>18 min</span>
              </div>
            </div>

            <div className="mc-tracking-line">
              {[
                ['✓', 'Confirmed'],
                ['✓', 'Prepared'],
                ['●', 'Picked up'],
                ['', 'Delivered'],
              ].map(([mark, label], index) => (
                <div
                  className={`mc-track-step ${
                    index < 2 ? 'done' : index === 2 ? 'current' : ''
                  }`}
                  key={label}
                >
                  <span>{mark}</span>
                  <small>{label}</small>
                </div>
              ))}
            </div>

            <div className="mc-tracking-footer">
              <span className="mc-tracking-rider-dot" />

              <div>
                <small>RIDER STATUS</small>
                <strong>Picked up from City Care Pharmacy</strong>
              </div>

              <span>On the way</span>
            </div>
          </div>
        </section>

        <section className="mc-two-sided mc-reveal">
          <div className="mc-section-copy">
            <span>FOR PHARMACIES</span>

            <h2>Make your pharmacy easier to find and easier to operate.</h2>

            <p>
              Keep inventory visible, receive customer demand, review prescriptions
              and manage orders from one connected pharmacy workspace.
            </p>
          </div>

          <div className="mc-pharmacy-benefits">
            <article>
              <span>01</span>
              <strong>Be discovered nearby</strong>
              <p>
                Customers searching for medicines can see your pharmacy when you
                have relevant stock available.
              </p>
            </article>

            <article>
              <span>02</span>
              <strong>Keep inventory visible</strong>
              <p>
                Update stock and availability so customers know what is actually
                available before they arrive.
              </p>
            </article>

            <article>
              <span>03</span>
              <strong>Manage incoming orders</strong>
              <p>
                Handle customer orders and fulfilment choices from the pharmacy side.
              </p>
            </article>

            <article>
              <span>04</span>
              <strong>Review prescriptions</strong>
              <p>
                Review prescription-required orders before they continue through
                fulfilment.
              </p>
            </article>
          </div>

          <div className="mc-pharmacy-dashboard">
            <div className="mc-dashboard-top">
              <div>
                <small>PHARMACY DASHBOARD</small>
                <strong>Sharma Medical Store</strong>
              </div>

              <span>Live</span>
            </div>

            <div className="mc-dashboard-grid">
              <article>
                <small>Available medicines</small>
                <strong>248</strong>
                <span>Inventory visible</span>
              </article>

              <article>
                <small>Orders today</small>
                <strong>18</strong>
                <span>6 awaiting action</span>
              </article>

              <article>
                <small>Prescription reviews</small>
                <strong>4</strong>
                <span>Needs attention</span>
              </article>
            </div>

            <div className="mc-dashboard-feed">
              <div>
                <i className="good" />
                <span>Dolo 650 inventory updated</span>
                <small>2 min ago</small>
              </div>

              <div>
                <i />
                <span>New customer order received</span>
                <small>5 min ago</small>
              </div>

              <div>
                <i className="rx" />
                <span>Prescription awaiting review</span>
                <small>8 min ago</small>
              </div>
            </div>
          </div>
        </section>

        

        <section className="mc-final mc-reveal" id="mc-final-section">
          <span>STILL LOOKING FOR A MEDICINE?</span>

          <h2>Start with the medicine you need.</h2>

          <p>
            We’ll help you find where to get it.
          </p>

          <button type="button" onClick={openSearch}>
            <SearchIcon />
            <span>Search Dolo 650, Crocin, Paracetamol...</span>
            <ArrowIcon />
          </button>
        </section>
      </main>

      <footer className="mc-footer" id="mc-footer">
        <div>
          <span className="mc-logo">M</span>
          <strong>MediConnect</strong>
        </div>

        <p>Connecting customers with local pharmacies.</p>

        <nav>
          <button type="button">Customer</button>
          <button type="button">Pharmacies</button>
          <button type="button">Support</button>
          <button type="button">Privacy</button>
        </nav>
      </footer>

      <div
        className={`mc-floating-search ${
          showFloatingSearch && !searchFlowOpen && !nearPageEnd ? 'visible' : ''
        }`}
      >
        <button type="button" onClick={openSearch}>
          <SearchIcon />
          <span>Search medicines nearby</span>
          <ArrowIcon />
        </button>
      </div>
    </div>
  )
}

export default LandingPage
