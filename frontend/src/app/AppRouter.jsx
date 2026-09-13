import { BrowserRouter, Route, Routes } from 'react-router-dom'

import LandingExperience from '../App'
import CustomerApp from '../features/customer/CustomerApp'
import CustomerSearch from '../features/customer/CustomerSearch'
import CustomerPharmacyResults from '../features/customer/CustomerPharmacyResults'
import CustomerPharmacyDetail from '../features/customer/CustomerPharmacyDetail'
import CustomerCart from '../features/customer/CustomerCart'
import CustomerCheckout from '../features/customer/CustomerCheckout'
import CustomerShell from '../features/customer/CustomerShell'
import { AuthProvider } from '../context/AuthContext'
import RiderApp from '../features/rider/RiderApp'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingExperience />} />
          <Route path="/app" element={<CustomerShell />}>
            <Route index element={<CustomerApp />} />
            <Route path="search" element={<CustomerSearch />} />
            <Route path="results" element={<CustomerPharmacyResults />} />
            <Route
              path="pharmacy/:pharmacyId"
              element={<CustomerPharmacyDetail />}
            />
            <Route path="cart" element={<CustomerCart />} />
            <Route path="checkout" element={<CustomerCheckout />} />
          </Route>
          <Route path="/rider" element={<RiderApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
