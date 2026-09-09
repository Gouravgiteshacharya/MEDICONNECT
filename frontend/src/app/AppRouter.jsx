import { BrowserRouter, Route, Routes } from 'react-router-dom'

import CustomerApp from '../App'
import { AuthProvider } from '../context/AuthContext'
import RiderApp from '../features/rider/RiderApp'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<CustomerApp />} />
          <Route path="/rider" element={<RiderApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
