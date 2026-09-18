import { useEffect, useRef, useState } from 'react'

import { loadGooglePlaces, placeDestination } from './googlePlaces'

function friendlyPlacesError(error) {
  if (error?.message === 'GOOGLE_PLACES_KEY_MISSING') {
    return 'Address search is not configured for this environment. Use current location or a saved address.'
  }
  return 'Address search is temporarily unavailable. Try again or use another destination option.'
}

function suggestionText(prediction) {
  return prediction.text?.toString() || prediction.mainText?.text || 'Suggested address'
}

export default function ManualAddressSearch({ onSelect }) {
  const sessionToken = useRef(null)
  const requestSequence = useRef(0)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const normalizedQuery = query.trim()
    const sequence = ++requestSequence.current

    if (normalizedQuery.length < 3) {
      setSuggestions([])
      setActiveIndex(-1)
      setStatus('idle')
      return
    }

    const timer = window.setTimeout(async () => {
      setStatus('loading')
      setError('')

      try {
        const places = await loadGooglePlaces()
        if (!sessionToken.current) {
          sessionToken.current = new places.AutocompleteSessionToken()
        }
        const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: normalizedQuery,
          includedRegionCodes: ['in'],
          language: 'en-IN',
          sessionToken: sessionToken.current,
        })

        if (sequence !== requestSequence.current) return
        const predictions = result.suggestions
          .map((item) => item.placePrediction)
          .filter(Boolean)
        setSuggestions(predictions)
        setActiveIndex(predictions.length ? 0 : -1)
        setStatus(predictions.length ? 'ready' : 'empty')
      } catch (requestError) {
        if (sequence !== requestSequence.current) return
        setSuggestions([])
        setStatus('error')
        setError(friendlyPlacesError(requestError))
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [query])

  async function selectSuggestion(prediction) {
    setStatus('resolving')
    setError('')

    try {
      const place = prediction.toPlace()
      await place.fetchFields({
        fields: [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'addressComponents',
        ],
      })
      const destination = placeDestination(place)
      if (!destination) {
        setStatus('error')
        setError('This result does not include a usable map location. Choose another suggestion.')
        return
      }
      sessionToken.current = null
      onSelect(destination)
    } catch {
      setStatus('error')
      setError('We could not resolve that address. Choose another suggestion or try again.')
    }
  }

  function handleKeyDown(event) {
    if (!suggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectSuggestion(suggestions[activeIndex])
    } else if (event.key === 'Escape') {
      setSuggestions([])
      setActiveIndex(-1)
    }
  }

  return <div className="customer-manual-address">
    <small>ENTER ANOTHER ADDRESS</small>
    <label>
      <span>Search an address, area, or locality in India</span>
      <input
        type="search"
        value={query}
        placeholder="Atopur, Keonjhar, Odisha"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls="customer-address-suggestions"
        aria-activedescendant={activeIndex >= 0 ? `customer-address-option-${activeIndex}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </label>

    {status === 'loading' && <p>Searching addresses…</p>}
    {status === 'resolving' && <p>Confirming this location…</p>}
    {status === 'empty' && <p>No matching addresses found. Try a nearby locality or postal code.</p>}
    {error && <p className="error">{error}</p>}

    {suggestions.length > 0 && <div id="customer-address-suggestions" className="customer-address-suggestions" role="listbox">
      {suggestions.map((prediction, index) => <button
        id={`customer-address-option-${index}`}
        key={`${prediction.placeId}-${index}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? 'active' : ''}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectSuggestion(prediction)}
      ><span>⌖</span><strong>{suggestionText(prediction)}</strong></button>)}
      <div className="customer-google-attribution"><img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" /></div>
    </div>}
  </div>
}
