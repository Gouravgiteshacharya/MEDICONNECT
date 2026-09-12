import { BrowserRouter, Route, Routes } from 'react-router-dom'

import LandingExperience from '../App'
import CustomerApp from '../features/customer/CustomerApp'
import CustomerSearch from '../features/customer/CustomerSearch'
import CustomerPharmacyResults from '../features/customer/CustomerPharmacyResults'
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
          </Route>
          <Route path="/rider" element={<RiderApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
