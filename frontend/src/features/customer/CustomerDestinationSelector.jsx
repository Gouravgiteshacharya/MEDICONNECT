import { useState } from 'react'

import { useAuth } from '../../context/AuthContext'
import { destinationFromAddress, useCustomerDestination } from './CustomerDestinationContext'
import './CustomerDestinationSelector.css'

function locationErrorMessage(error) {
  if (error?.code === 1) return 'Location permission was denied. Choose a saved address instead.'
  if (error?.code === 3) return 'Location took too long. Try again or choose a saved address.'
  return 'Current location is unavailable. Choose a saved address instead.'
}

export default function CustomerDestinationSelector({ compact = false }) {
  const { authenticated } = useAuth()
  const { destination, setDestination, addresses, addressesLoading, addressesError } = useCustomerDestination()
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState({ address: '', city: '', state: '', postalCode: '' })

  function useCurrentLocation() {
    setError('')
    if (!navigator.geolocation) {
      setError('Current location is not supported. Choose a saved address instead.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDestination({
          label: 'Current location',
          readableAddress: 'Your device location',
          city: '', state: '', postalCode: '',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: 'CURRENT_LOCATION',
        })
        setLocating(false)
        setOpen(false)
      },
      (locationError) => {
        setError(locationErrorMessage(locationError))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  function chooseSaved(address) {
    const next = destinationFromAddress(address)
    if (!next) {
      setError(`${address.label} does not have a delivery-ready location yet.`)
      return
    }
    setDestination(next)
    setOpen(false)
  }

  return <>
    <button className={`customer-destination-trigger ${compact ? 'compact' : ''}`} type="button" onClick={() => setOpen(true)}>
      <span>⌖</span><span><small>Deliver medicines to</small><strong>{destination?.label || 'Choose destination'}</strong>{!compact && destination?.city && <em>{destination.city}, {destination.state}</em>}</span><b>⌄</b>
    </button>

    {open && <div className="customer-destination-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="customer-destination-sheet" role="dialog" aria-modal="true" aria-label="Choose delivery destination">
        <header><div><small>SEARCH NEAR</small><h2>Choose destination</h2><p>Pharmacy availability will use this location, not your device location unless you choose it.</p></div><button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button></header>

        <button className="customer-destination-current" type="button" disabled={locating} onClick={useCurrentLocation}><span>⌖</span><span><strong>{locating ? 'Getting current location…' : 'Use current location'}</strong><small>Uses browser location for this session only</small></span></button>

        {authenticated && <div className="customer-destination-section"><small>SAVED ADDRESSES</small>{addressesLoading && <p>Loading saved addresses…</p>}{addresses.map((address) => <button type="button" key={address.id} onClick={() => chooseSaved(address)} disabled={!destinationFromAddress(address)}><span><strong>{address.label}</strong><small>{address.addressLine1}, {address.city}, {address.state}</small></span>{!destinationFromAddress(address) && <em>Location required</em>}</button>)}{!addressesLoading && addresses.length === 0 && <p>No saved addresses yet.</p>}{addressesError && <p>{addressesError}</p>}</div>}

        <div className="customer-destination-section manual"><small>ANOTHER ADDRESS</small><input placeholder="Street or area" value={manual.address} onChange={(event) => setManual({ ...manual, address: event.target.value })}/><div><input placeholder="City" value={manual.city} onChange={(event) => setManual({ ...manual, city: event.target.value })}/><input placeholder="State" value={manual.state} onChange={(event) => setManual({ ...manual, state: event.target.value })}/></div><input placeholder="Postal code" value={manual.postalCode} onChange={(event) => setManual({ ...manual, postalCode: event.target.value })}/><p>Address search is not configured yet. MediConnect needs Google Places or Geocoding to turn this address into a verified map location before it can search nearby pharmacies.</p><button type="button" disabled>Resolve and use address</button></div>

        {error && <div className="customer-destination-error">{error}</div>}
      </section>
    </div>}
  </>
}
