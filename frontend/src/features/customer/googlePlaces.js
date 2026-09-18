let placesPromise

export function loadGooglePlaces() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

  if (!apiKey) {
    return Promise.reject(new Error('GOOGLE_PLACES_KEY_MISSING'))
  }

  if (window.google?.maps?.importLibrary) {
    return window.google.maps.importLibrary('places')
  }

  if (placesPromise) return placesPromise

  placesPromise = new Promise((resolve, reject) => {
    const callbackName = '__mediconnectGoogleMapsReady'
    const script = document.createElement('script')

    window[callbackName] = async () => {
      try {
        resolve(await window.google.maps.importLibrary('places'))
      } catch {
        placesPromise = undefined
        reject(new Error('GOOGLE_PLACES_LOAD_FAILED'))
      } finally {
        delete window[callbackName]
      }
    }

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`
    script.async = true
    script.onerror = () => {
      delete window[callbackName]
      placesPromise = undefined
      reject(new Error('GOOGLE_PLACES_LOAD_FAILED'))
    }
    document.head.appendChild(script)
  })

  return placesPromise
}

export function placeDestination(place) {
  const components = place.addressComponents ?? []
  const component = (...types) => components.find((item) =>
    types.some((type) => item.types?.includes(type)),
  )
  const city = component(
    'locality',
    'postal_town',
    'administrative_area_level_3',
    'administrative_area_level_2',
  )?.longText ?? ''
  const state = component('administrative_area_level_1')?.longText ?? ''
  const postalCode = component('postal_code')?.longText ?? ''
  const latitude = place.location?.lat()
  const longitude = place.location?.lng()

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const readableAddress = place.formattedAddress || place.displayName || 'Selected address'

  return {
    placeId: place.id,
    label: place.displayName || city || readableAddress.split(',')[0],
    readableAddress,
    city,
    state,
    postalCode,
    latitude,
    longitude,
    source: 'MANUAL_ADDRESS',
  }
}
