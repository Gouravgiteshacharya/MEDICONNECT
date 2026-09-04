import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const medicines = [
  { name: 'Dolo 650', composition: 'Paracetamol 650 mg', form: 'Tablet', rx: false },
  { name: 'Dolo 500', composition: 'Paracetamol 500 mg', form: 'Tablet', rx: false },
  { name: 'Crocin 650', composition: 'Paracetamol 650 mg', form: 'Tablet', rx: false },
  {
    name: 'Azithral 500',
    composition: 'Azithromycin 500 mg',
    form: 'Tablet',
    rx: true,
  },
]

const pharmacies = [
  {
    id: 1,
    name: 'Sharma Medical Store',
    distance: '850 m',
    distanceValue: 0.85,
    rating: 4.8,
    price: 32,
    availability: 'IN STOCK',
    freshness: 'Updated 6 min ago',
    status: 'stock',
    delivery: '22–30 min',
    deliveryMinutes: 22,
    pickup: 'Ready in 10 min',
    verified: true,
  },
  {
    id: 2,
    name: 'City Care Pharmacy',
    distance: '1.2 km',
    distanceValue: 1.2,
    rating: 4.7,
    price: 30,
    availability: 'CONFIRMED',
    freshness: 'Confirmed by pharmacy 12 min ago',
    status: 'confirmed',
    delivery: '28–36 min',
    deliveryMinutes: 28,
    pickup: 'Ready in 15 min',
    verified: true,
  },
  {
    id: 3,
    name: 'Health Point Pharmacy',
    distance: '600 m',
    distanceValue: 0.6,
    rating: 4.5,
    price: 31,
    availability: 'CHECKING',
    freshness: "We've asked the pharmacy",
    status: 'checking',
    delivery: 'Availability pending',
    deliveryMinutes: 99,
    pickup: 'Awaiting confirmation',
    verified: true,
  },
]

function SearchIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12h14m-5-5 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 12 4 4L19 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function App() {
  const heroSearchRef = useRef(null)

  const [view, setView] = useState('home')
  const [showFloatingSearch, setShowFloatingSearch] = useState(false)
  const [searchFlowOpen, setSearchFlowOpen] = useState(false)
  const [step, setStep] = useState('location')
  const [location, setLocation] = useState('')
  const [medicineQuery, setMedicineQuery] = useState('')
  const [selectedMedicine, setSelectedMedicine] = useState(null)

  const [sortBy, setSortBy] = useState('Recommended')
  const [cart, setCart] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [fulfilment, setFulfilment] = useState('pickup')
  const [orderConfirmed, setOrderConfirmed] = useState(false)
  const [deliveryTracking, setDeliveryTracking] = useState(false)
  const [storefront, setStorefront] = useState(null)

  useEffect(() => {
    const target = heroSearchRef.current
    if (!target) return

    const observer = new IntersectionObserver(([entry]) => {
      setShowFloatingSearch(!entry.isIntersecting)
    })

    observer.observe(target)
    return () => observer.disconnect()
  }, [view])

  useEffect(() => {
    const shouldLock = searchFlowOpen || cartOpen || orderConfirmed
    document.body.style.overflow = shouldLock ? 'hidden' : ''

    return () => {
      document.body.style.overflow = ''
    }
  }, [searchFlowOpen, cartOpen, orderConfirmed])

  const filteredMedicines = useMemo(() => {
    if (!medicineQuery.trim()) return medicines.slice(0, 4)

    const query = medicineQuery.toLowerCase()

    return medicines.filter(
      (medicine) =>
        medicine.name.toLowerCase().includes(query) ||
        medicine.composition.toLowerCase().includes(query),
    )
  }, [medicineQuery])

  const sortedPharmacies = useMemo(() => {
    const items = [...pharmacies]

    if (sortBy === 'Nearest') {
      return items.sort((a, b) => a.distanceValue - b.distanceValue)
    }

    if (sortBy === 'Lowest Price') {
      return items.sort((a, b) => a.price - b.price)
    }

    if (sortBy === 'Fastest') {
      return items.sort((a, b) => a.deliveryMinutes - b.deliveryMinutes)
    }

    return items
  }, [sortBy])

  const openSearch = () => {
    setSearchFlowOpen(true)
    setStep(location ? 'medicine' : 'location')
  }

  const closeSearch = () => {
    setSearchFlowOpen(false)
  }

  const useCurrentLocation = () => {
    setLocation('Brahmapur, Odisha')
    setStep('medicine')
  }

  const findPharmacies = () => {
    if (!selectedMedicine) return

    setSearchFlowOpen(false)
    setView('results')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addToCart = (pharmacy) => {
    if (pharmacy.status === 'checking') return

    setCart({
      pharmacy,
      medicine: selectedMedicine,
    })
    setQuantity(1)
    setCartOpen(true)
  }

  const subtotal = cart ? cart.pharmacy.price * quantity : 0
  const deliveryFee = fulfilment === 'delivery' ? 35 : 0
  const total = subtotal + deliveryFee

  const resetDemo = () => {
    setOrderConfirmed(false)
    setCartOpen(false)
    setCart(null)
    setQuantity(1)
    setFulfilment('pickup')
    setView('home')
    setSelectedMedicine(null)
    setMedicineQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      {view === 'home' ? (
        <>
          <header className="nav">
            <button className="brand brand-button" type="button" onClick={() => setView('home')}>
              <span className="brand-mark">M</span>
              <span>MediConnect</span>
            </button>

            <nav className="nav-actions">
              <button className="nav-link">For Pharmacies</button>
              <button className="nav-link">How it works</button>
            </nav>
          </header>

          <main>
            <section className="hero-section">
              <div className="hero-content">
                <div className="eyebrow">
                  <span className="eyebrow-dot" />
                  Your local pharmacies, connected.
                </div>

                <h1>
                  Find your medicine.
                  <span> Nearby.</span>
                </h1>

                <p className="hero-copy">
                  Search once. See which local pharmacies actually have the medicine you
                  need — then choose pickup or delivery.
                </p>

                <button
                  ref={heroSearchRef}
                  className="hero-search"
                  type="button"
                  onClick={openSearch}
                >
                  <span className="search-icon">
                    <SearchIcon />
                  </span>

                  <span className="search-placeholder">
                    Search for a medicine...
                  </span>

                  <span className="search-action">
                    Search
                    <ArrowIcon />
                  </span>
                </button>

                <div className="auth-actions">
                  <span>New to MediConnect?</span>
                  <button type="button">Sign up</button>
                  <span>•</span>
                  <button type="button">Log in</button>
                </div>

                <div className="hero-trust">
                  <div>
                    <strong>Nearby</strong>
                    <span>local pharmacies</span>
                  </div>

                  <div>
                    <strong>Verified</strong>
                    <span>medicine availability</span>
                  </div>

                  <div>
                    <strong>Your choice</strong>
                    <span>pickup or delivery</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="story-section">
              <div className="section-heading">
                <span>01 — Search</span>
                <h2>One search across your local pharmacy network.</h2>
                <p>
                  Instead of calling pharmacy after pharmacy, tell MediConnect what
                  medicine you need.
                </p>
              </div>

              <div className="demo-window">
                <div className="demo-search">
                  <SearchIcon />
                  <span>Dolo 650</span>
                </div>

                <div className="demo-result">
                  <div>
                    <strong>Sharma Medical Store</strong>
                    <p>850 m away</p>
                  </div>

                  <div className="availability">
                    <strong>In stock</strong>
                    <span>Updated 6 min ago</span>
                  </div>
                </div>

                <div className="demo-result">
                  <div>
                    <strong>City Care Pharmacy</strong>
                    <p>1.2 km away</p>
                  </div>

                  <div className="availability">
                    <strong>Confirmed</strong>
                    <span>12 min ago</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="local-section">
              <div className="local-card">
                <span>02 — Choose local</span>
                <h2>Your neighbourhood pharmacy gets a digital storefront.</h2>
                <p>
                  Compare nearby independent pharmacies by availability,
                  distance, price and fulfilment.
                </p>
              </div>

              <div className="local-card dark-card">
                <span>03 — Fulfilment</span>
                <h2>Reserve for pickup. Or let MediConnect deliver.</h2>
                <p>
                  Once you've found the pharmacy, choose the fulfilment option
                  that works for you.
                </p>
              </div>
            </section>

            <section className="mission-section">
              <p>Why MediConnect</p>
              <h2>
                We're not replacing local pharmacies. We're connecting them.
              </h2>

              <button type="button" onClick={openSearch}>
                Find medicine near me
                <ArrowIcon />
              </button>
            </section>
          </main>

          <div
            className={`floating-search-wrap ${
              showFloatingSearch && !searchFlowOpen ? 'visible' : ''
            }`}
          >
            <button
              className="floating-search"
              type="button"
              onClick={openSearch}
            >
              <SearchIcon />
              <span>Search medicines nearby...</span>

              <div>
                Search
                <ArrowIcon />
              </div>
            </button>
          </div>
        </>
      ) : (
        <div className="results-page">
          <header className="results-header">
            <button
              className="brand brand-button"
              type="button"
              onClick={() => setView('home')}
            >
              <span className="brand-mark">M</span>
              <span>MediConnect</span>
            </button>

            <button className="results-location" type="button" onClick={openSearch}>
              <LocationIcon />
              <span>{location}</span>
              <small>Change</small>
            </button>

            {cart && (
              <button
                className="header-cart"
                type="button"
                onClick={() => setCartOpen(true)}
              >
                Cart
                <span>{quantity}</span>
              </button>
            )}
          </header>

          <main className="results-main">
            <button
              className="back-link"
              type="button"
              onClick={() => {
                setView('home')
                setTimeout(openSearch, 100)
              }}
            >
              ← Change medicine
            </button>

            <section className="results-intro">
              <div>
                <p className="result-kicker">Available near you</p>

                <h1>
                  {selectedMedicine?.name}
                  <span> nearby.</span>
                </h1>

                <div className="medicine-meta">
                  <span>{selectedMedicine?.composition}</span>
                  <span>•</span>
                  <span>{selectedMedicine?.form}</span>

                  {selectedMedicine?.rx && (
                    <>
                      <span>•</span>
                      <strong>Prescription required</strong>
                    </>
                  )}
                </div>
              </div>

              <button className="add-another" type="button" onClick={openSearch}>
                + Add another medicine
              </button>
            </section>

            <section className="results-toolbar">
              <div>
                <strong>3 pharmacies</strong>
                <span> around {location}</span>
              </div>

              <div className="sort-buttons">
                {['Recommended', 'Nearest', 'Lowest Price', 'Fastest'].map(
                  (sort) => (
                    <button
                      key={sort}
                      type="button"
                      className={sortBy === sort ? 'active' : ''}
                      onClick={() => setSortBy(sort)}
                    >
                      {sort}
                    </button>
                  ),
                )}
              </div>
            </section>

            <section className="pharmacy-results">
              {sortedPharmacies.map((pharmacy, index) => (
                <article
                  className={`pharmacy-card ${
                    pharmacy.status === 'checking' ? 'checking-card' : ''
                  }`}
                  key={pharmacy.id}
                >
                  {index === 0 && sortBy === 'Recommended' && (
                    <div className="recommended-label">Best match</div>
                  )}

                  <div className="pharmacy-card-top">
                    <div className="pharmacy-avatar">
                      {pharmacy.name.charAt(0)}
                    </div>

                    <div className="pharmacy-identity">
                      <div className="pharmacy-name-row">
                        <h3>{pharmacy.name}</h3>

                        {pharmacy.verified && (
                          <span className="verified">
                            <CheckIcon />
                            Verified
                          </span>
                        )}
                      </div>

                      <p>
                        ★ {pharmacy.rating} &nbsp;•&nbsp; {pharmacy.distance} away
                      </p>
                    </div>
                  </div>

                  <div className="availability-block">
                    <div>
                      <span className={`availability-dot ${pharmacy.status}`} />

                      <div>
                        <strong>{pharmacy.availability}</strong>
                        <p>{pharmacy.freshness}</p>
                      </div>
                    </div>

                    {pharmacy.status !== 'checking' && (
                      <strong className="medicine-price">
                        ₹{pharmacy.price}
                      </strong>
                    )}
                  </div>

                  <div className="fulfilment-row">
                    <div>
                      <span>Pickup</span>
                      <strong>{pharmacy.pickup}</strong>
                    </div>

                    <div>
                      <span>Delivery</span>
                      <strong>{pharmacy.delivery}</strong>
                    </div>
                  </div>

                  <div className="pharmacy-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setStorefront(pharmacy)}
                    >
                      View pharmacy
                    </button>

                    <button
                      className="primary-button"
                      type="button"
                      disabled={pharmacy.status === 'checking'}
                      onClick={() => addToCart(pharmacy)}
                    >
                      {pharmacy.status === 'checking'
                        ? 'Checking availability'
                        : 'Add to cart'}
                    </button>
                  </div>
                </article>
              ))}
            </section>

            <div className="results-note">
              <strong>Availability you can understand.</strong>
              <p>
                Integrated pharmacies show when stock was last updated.
                Other pharmacies confirm availability directly with MediConnect.
              </p>
            </div>
          </main>
        </div>
      )}


      {storefront && (
        <div className="storefront-overlay">
          <button
            className="overlay-backdrop"
            type="button"
            aria-label="Close pharmacy"
            onClick={() => setStorefront(null)}
          />

          <div className="storefront-panel">
            <div className="storefront-topbar">
              <button
                className="storefront-back"
                type="button"
                onClick={() => setStorefront(null)}
              >
                ← Back to results
              </button>

              <button
                className="close-button"
                type="button"
                onClick={() => setStorefront(null)}
              >
                ×
              </button>
            </div>

            <section className="storefront-hero">
              <div className="storefront-avatar">
                {storefront.name.charAt(0)}
              </div>

              <div className="storefront-title">
                <div className="storefront-badges">
                  <span className="verified">
                    <CheckIcon />
                    Verified pharmacy
                  </span>

                  <span className="open-badge">Open now</span>
                </div>

                <h2>{storefront.name}</h2>

                <p>
                  ★ {storefront.rating} &nbsp;•&nbsp; {storefront.distance} away
                  &nbsp;•&nbsp; Brahmapur, Odisha
                </p>
              </div>
            </section>

            <div className="storefront-quick-actions">
              <button type="button">
                <span>Directions</span>
                <small>{storefront.distance} away</small>
              </button>

              <button type="button">
                <span>Call pharmacy</span>
                <small>Contact store</small>
              </button>

              <button type="button">
                <span>Store hours</span>
                <small>8:00 AM – 10:00 PM</small>
              </button>
            </div>

            <section className="storefront-fulfilment">
              <div>
                <span>Pickup</span>
                <strong>{storefront.pickup}</strong>
                <small>Reserve before you leave</small>
              </div>

              <div>
                <span>MediConnect Delivery</span>
                <strong>{storefront.delivery}</strong>
                <small>Delivered from this pharmacy</small>
              </div>
            </section>

            <section className="storefront-medicines">
              <div className="storefront-section-heading">
                <div>
                  <span>Available here</span>
                  <h3>Your medicine</h3>
                </div>

                <button type="button">Search this pharmacy</button>
              </div>

              <article className="storefront-medicine-card">
                <div className="medicine-pack">
                  <span>Rx</span>
                </div>

                <div className="storefront-medicine-info">
                  <h4>{selectedMedicine?.name}</h4>
                  <p>{selectedMedicine?.composition}</p>
                  <small>{selectedMedicine?.form}</small>

                  <div className="storefront-stock">
                    <span className={`availability-dot ${storefront.status}`} />
                    <div>
                      <strong>{storefront.availability}</strong>
                      <small>{storefront.freshness}</small>
                    </div>
                  </div>
                </div>

                <div className="storefront-medicine-action">
                  <strong>₹{storefront.price}</strong>

                  <button
                    type="button"
                    disabled={storefront.status === 'checking'}
                    onClick={() => {
                      addToCart(storefront)
                      setStorefront(null)
                    }}
                  >
                    {storefront.status === 'checking'
                      ? 'Checking'
                      : 'Add to cart'}
                  </button>
                </div>
              </article>
            </section>

            <section className="storefront-about">
              <div>
                <span>About this pharmacy</span>
                <h3>A local pharmacy, digitally connected.</h3>
              </div>

              <p>
                {storefront.name} is part of the MediConnect local pharmacy
                network. The pharmacy remains the seller while MediConnect helps
                customers discover medicine availability, reserve pickup and
                arrange delivery.
              </p>
            </section>

            <section className="storefront-trust">
              <div>
                <strong>Verified</strong>
                <span>Pharmacy profile</span>
              </div>

              <div>
                <strong>{storefront.rating} ★</strong>
                <span>Customer rating</span>
              </div>

              <div>
                <strong>Reliable</strong>
                <span>Availability updates</span>
              </div>
            </section>
          </div>
        </div>
      )}

      {searchFlowOpen && (
        <div className="search-overlay">
          <button
            className="overlay-backdrop"
            type="button"
            aria-label="Close"
            onClick={closeSearch}
          />

          <div className="search-panel">
            <div className="panel-header">
              <div>
                <span>{step === 'location' ? 'Step 1 of 2' : 'Step 2 of 2'}</span>

                <h2>
                  {step === 'location'
                    ? 'Where should we search?'
                    : 'What medicine do you need?'}
                </h2>
              </div>

              <button
                className="close-button"
                type="button"
                onClick={closeSearch}
              >
                ×
              </button>
            </div>

            {step === 'location' ? (
              <div className="location-step">
                <button
                  className="current-location"
                  type="button"
                  onClick={useCurrentLocation}
                >
                  <span className="location-box">
                    <LocationIcon />
                  </span>

                  <div>
                    <strong>Use my current location</strong>
                    <p>Find pharmacies closest to you</p>
                  </div>

                  <ArrowIcon />
                </button>
              </div>
            ) : (
              <div className="medicine-step">
                <button
                  className="selected-location"
                  type="button"
                  onClick={() => setStep('location')}
                >
                  <LocationIcon />
                  <span>{location}</span>
                  <small>Change</small>
                </button>

                <div className="medicine-input">
                  <SearchIcon />

                  <input
                    autoFocus
                    value={medicineQuery}
                    onChange={(event) => {
                      setMedicineQuery(event.target.value)
                      setSelectedMedicine(null)
                    }}
                    placeholder="Start typing a medicine..."
                  />
                </div>

                <div className="medicine-suggestions">
                  {filteredMedicines.map((medicine) => (
                    <button
                      key={medicine.name}
                      className={`medicine-option ${
                        selectedMedicine?.name === medicine.name
                          ? 'selected'
                          : ''
                      }`}
                      type="button"
                      onClick={() => setSelectedMedicine(medicine)}
                    >
                      <div>
                        <strong>{medicine.name}</strong>
                        <span>{medicine.composition}</span>
                        <small>
                          {medicine.form}
                          {medicine.rx ? ' • Prescription required' : ''}
                        </small>
                      </div>

                      <span>→</span>
                    </button>
                  ))}
                </div>

                {selectedMedicine && (
                  <button
                    className="find-pharmacies-button"
                    type="button"
                    onClick={findPharmacies}
                  >
                    Find {selectedMedicine.name} nearby
                    <ArrowIcon />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {cart && !cartOpen && view === 'results' && (
        <button
          className="cart-floating"
          type="button"
          onClick={() => setCartOpen(true)}
        >
          <div>
            <span>1 medicine</span>
            <strong>{cart.pharmacy.name}</strong>
          </div>

          <div>
            View cart · ₹{subtotal}
            <ArrowIcon />
          </div>
        </button>
      )}

      {cartOpen && cart && (
        <div className="cart-overlay">
          <button
            className="overlay-backdrop"
            type="button"
            aria-label="Close cart"
            onClick={() => setCartOpen(false)}
          />

          <aside className="cart-drawer">
            <div className="cart-header">
              <div>
                <span>Your pharmacy cart</span>
                <h2>{cart.pharmacy.name}</h2>
              </div>

              <button
                className="close-button"
                type="button"
                onClick={() => setCartOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="cart-verified">
              <CheckIcon />
              Verified local pharmacy
            </div>

            <div className="cart-item">
              <div>
                <strong>{cart.medicine.name}</strong>
                <span>{cart.medicine.composition}</span>
                <small>{cart.medicine.form}</small>
              </div>

              <strong>₹{cart.pharmacy.price}</strong>
            </div>

            <div className="quantity-row">
              <span>Quantity</span>

              <div className="quantity-control">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  −
                </button>

                <strong>{quantity}</strong>

                <button
                  type="button"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  +
                </button>
              </div>
            </div>

            {cart.medicine.rx && (
              <div className="rx-warning">
                <strong>Prescription required</strong>
                <p>
                  An authorized pharmacy professional will review your
                  prescription before fulfilment.
                </p>
              </div>
            )}

            <div className="fulfilment-title">
              How do you want to get it?
            </div>

            <div className="fulfilment-options">
              <button
                type="button"
                className={fulfilment === 'pickup' ? 'selected' : ''}
                onClick={() => setFulfilment('pickup')}
              >
                <strong>Pickup</strong>
                <span>{cart.pharmacy.pickup}</span>
                <small>Reserve at pharmacy</small>
              </button>

              <button
                type="button"
                className={fulfilment === 'delivery' ? 'selected' : ''}
                onClick={() => setFulfilment('delivery')}
              >
                <strong>Delivery</strong>
                <span>{cart.pharmacy.delivery}</span>
                <small>Delivered by MediConnect</small>
              </button>
            </div>

            <div className="order-summary">
              <div>
                <span>Medicine subtotal</span>
                <strong>₹{subtotal}</strong>
              </div>

              {fulfilment === 'delivery' && (
                <div>
                  <span>Delivery</span>
                  <strong>₹{deliveryFee}</strong>
                </div>
              )}

              <div className="total-row">
                <span>Total</span>
                <strong>₹{total}</strong>
              </div>
            </div>

            <button
              className="checkout-button"
              type="button"
              onClick={() => {
                setCartOpen(false)

                if (fulfilment === 'delivery') {
                  setDeliveryTracking(true)
                } else {
                  setOrderConfirmed(true)
                }
              }}
            >
              {fulfilment === 'pickup'
                ? 'Reserve for pickup'
                : 'Continue to delivery'}
              <ArrowIcon />
            </button>

            <p className="seller-note">
              Sold by {cart.pharmacy.name}. MediConnect provides the marketplace
              and fulfilment infrastructure.
            </p>
          </aside>
        </div>
      )}

      {deliveryTracking && cart && (
        <div className="tracking-page">
          <header className="tracking-header">
            <button
              className="brand brand-button"
              type="button"
              onClick={resetDemo}
            >
              <span className="brand-mark">M</span>
              <span>MediConnect</span>
            </button>

            <span className="tracking-order-number">Order #MC4821</span>

            <button
              className="tracking-close"
              type="button"
              onClick={() => setDeliveryTracking(false)}
            >
              ×
            </button>
          </header>

          <main className="tracking-main">
            <section className="tracking-intro">
              <div>
                <span className="tracking-kicker">MediConnect Delivery</span>

                <h1>
                  Your medicine is
                  <span> on the way.</span>
                </h1>

                <p>
                  {cart.medicine.name} from {cart.pharmacy.name}
                </p>
              </div>

              <div className="eta-card">
                <span>Estimated arrival</span>
                <strong>18 min</strong>
                <small>Live estimate</small>
              </div>
            </section>

            <section className="tracking-grid">
              <div className="tracking-map">
                <div className="map-grid" />

                <div className="map-road road-one" />
                <div className="map-road road-two" />
                <div className="map-road road-three" />

                <div className="route-path route-one" />
                <div className="route-path route-two" />

                <div className="tracking-pin pharmacy-map-pin">
                  <span>P</span>
                  <small>Pharmacy</small>
                </div>

                <div className="tracking-pin rider-map-pin">
                  <span>R</span>
                  <small>Rider</small>
                </div>

                <div className="tracking-pin home-map-pin">
                  <span>H</span>
                  <small>You</small>
                </div>

                <div className="map-live">
                  <span />
                  Live tracking
                </div>
              </div>

              <aside className="tracking-sidebar">
                <div className="rider-card">
                  <div className="rider-avatar">AK</div>

                  <div className="rider-info">
                    <span>Your delivery partner</span>
                    <strong>Arjun Kumar</strong>
                    <small>★ 4.9 · 326 deliveries</small>
                  </div>

                  <button type="button">Call</button>
                </div>

                <div className="delivery-timeline">
                  <div className="delivery-step completed">
                    <span className="delivery-step-dot">
                      <CheckIcon />
                    </span>

                    <div>
                      <strong>Order confirmed</strong>
                      <small>Order accepted</small>
                    </div>
                  </div>

                  <div className="delivery-step completed">
                    <span className="delivery-step-dot">
                      <CheckIcon />
                    </span>

                    <div>
                      <strong>Prepared by pharmacy</strong>
                      <small>{cart.pharmacy.name}</small>
                    </div>
                  </div>

                  <div className="delivery-step current">
                    <span className="delivery-step-dot">
                      <i />
                    </span>

                    <div>
                      <strong>Picked up</strong>
                      <small>Arjun is heading towards you</small>
                    </div>
                  </div>

                  <div className="delivery-step">
                    <span className="delivery-step-dot" />

                    <div>
                      <strong>Arriving soon</strong>
                      <small>Estimated in 18 minutes</small>
                    </div>
                  </div>
                </div>

                <div className="tracking-order">
                  <div className="tracking-order-title">
                    <span>Your order</span>
                    <strong>₹{total}</strong>
                  </div>

                  <div className="tracking-product">
                    <div>
                      <strong>{cart.medicine.name}</strong>
                      <small>{cart.medicine.composition}</small>
                    </div>

                    <span>× {quantity}</span>
                  </div>

                  <div className="tracking-seller">
                    <span>Sold by</span>
                    <strong>{cart.pharmacy.name}</strong>
                  </div>
                </div>

                <div className="tracking-buttons">
                  <button type="button">Get help</button>

                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryTracking(false)
                      setOrderConfirmed(true)
                    }}
                  >
                    Simulate delivery
                  </button>
                </div>
              </aside>
            </section>
          </main>
        </div>
      )}

      {orderConfirmed && cart && (
        <div className="confirmation-overlay">
          <div className="confirmation-card">
            <div className="success-icon">
              <CheckIcon />
            </div>

            <span>
              {fulfilment === 'pickup'
                ? 'Pickup reserved'
                : 'Delivery ready to continue'}
            </span>

            <h2>
              {fulfilment === 'pickup'
                ? "We'll hold your medicine."
                : 'Your order is ready for delivery details.'}
            </h2>

            <p>
              {cart.medicine.name} · {quantity}{' '}
              {quantity === 1 ? 'unit' : 'units'} from {cart.pharmacy.name}
            </p>

            {fulfilment === 'pickup' ? (
              <div className="reservation-box">
                <span>Reservation window</span>
                <strong>60 minutes</strong>
                <small>Pickup code: MC-4821</small>
              </div>
            ) : (
              <div className="reservation-box">
                <span>Estimated delivery</span>
                <strong>{cart.pharmacy.delivery}</strong>
                <small>Delivered by MediConnect</small>
              </div>
            )}

            <button type="button" onClick={resetDemo}>
              Back to MediConnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
