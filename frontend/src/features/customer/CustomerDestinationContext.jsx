import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../../context/AuthContext'
import { listAddresses } from './addressService'

const SESSION_KEY = 'mediconnect_selected_destination'
const DestinationContext = createContext(null)

function hasCoordinates(value) {
  return Number.isFinite(Number(value?.latitude)) &&
    Number.isFinite(Number(value?.longitude))
}

function readableAddress(address) {
  return [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean).join(', ')
}

export function destinationFromAddress(address) {
  if (!hasCoordinates(address)) return null

  return {
    addressId: address.id,
    label: address.label,
    readableAddress: readableAddress(address),
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    latitude: Number(address.latitude),
    longitude: Number(address.longitude),
    source: 'SAVED_ADDRESS',
  }
}

function storedDestination() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY))
    return hasCoordinates(value) ? value : null
  } catch {
    return null
  }
}

export function CustomerDestinationProvider({ children }) {
  const { authenticated, initializing } = useAuth()
  const [destination, setDestinationState] = useState(storedDestination)
  const [addresses, setAddresses] = useState([])
  const [addressesLoading, setAddressesLoading] = useState(false)
  const [addressesError, setAddressesError] = useState('')

  useEffect(() => {
    if (initializing || !authenticated) {
      if (!authenticated) setAddresses([])
      return
    }

    let active = true
    setAddressesLoading(true)
    listAddresses()
      .then((result) => {
        if (!active) return
        setAddresses(result)
        setAddressesError('')
        if (!destination) {
          const defaultAddress = result.find((item) => item.isDefault && hasCoordinates(item))
          if (defaultAddress) setDestinationState(destinationFromAddress(defaultAddress))
        }
      })
      .catch((error) => {
        if (active) setAddressesError(error?.message || 'Unable to load saved addresses.')
      })
      .finally(() => { if (active) setAddressesLoading(false) })

    return () => { active = false }
  }, [authenticated, initializing, destination])

  useEffect(() => {
    if (!destination || destination.source === 'CURRENT_LOCATION') {
      sessionStorage.removeItem(SESSION_KEY)
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(destination))
    }
  }, [destination])

  function setDestination(value) {
    if (!hasCoordinates(value)) return false
    setDestinationState(value)
    return true
  }

  const value = useMemo(() => ({
    destination,
    setDestination,
    addresses,
    addressesLoading,
    addressesError,
  }), [destination, addresses, addressesLoading, addressesError])

  return <DestinationContext.Provider value={value}>{children}</DestinationContext.Provider>
}

export function useCustomerDestination() {
  const value = useContext(DestinationContext)
  if (!value) throw new Error('Customer destination context is unavailable.')
  return value
}
