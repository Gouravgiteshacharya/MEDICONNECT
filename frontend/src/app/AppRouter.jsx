import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'

import LandingExperience from '../App'
import AdminBlockedPage from '../features/admin/AdminBlockedPage'
import AdminDeliveries from '../features/admin/AdminDeliveries'
import AdminDeliveryDetail from '../features/admin/AdminDeliveryDetail'
import AdminOrderDetail from '../features/admin/AdminOrderDetail'
import AdminOrders from '../features/admin/AdminOrders'
import AdminOverview from '../features/admin/AdminOverview'
import AdminRiskDetail from '../features/admin/AdminRiskDetail'
import AdminShell from '../features/admin/AdminShell'
import AdminSupportDetail from '../features/admin/AdminSupportDetail'
import CustomerApp from '../features/customer/CustomerApp'
import CustomerSearch from '../features/customer/CustomerSearch'
import CustomerPharmacyResults from '../features/customer/CustomerPharmacyResults'
import CustomerPharmacyDetail from '../features/customer/CustomerPharmacyDetail'
import CustomerCart from '../features/customer/CustomerCart'
import CustomerCheckout from '../features/customer/CustomerCheckout'
import CustomerDeliveryAddress from '../features/customer/CustomerDeliveryAddress'
import CustomerOrderDetail from '../features/customer/CustomerOrderDetail'
import CustomerOrders from '../features/customer/CustomerOrders'
import CustomerPrescriptionDetail from '../features/customer/CustomerPrescriptionDetail'
import CustomerPrescriptions from '../features/customer/CustomerPrescriptions'
import CustomerProfile from '../features/customer/CustomerProfile'
import CustomerShell from '../features/customer/CustomerShell'
import PharmacyCatalogue from '../features/pharmacy/PharmacyCatalogue'
import PharmacyDashboard from '../features/pharmacy/PharmacyDashboard'
import PharmacyInventory from '../features/pharmacy/PharmacyInventory'
import PharmacyOrderAction from '../features/pharmacy/PharmacyOrderAction'
import PharmacyOrders from '../features/pharmacy/PharmacyOrders'
import PharmacyPrescriptionReview from '../features/pharmacy/PharmacyPrescriptionReview'
import PharmacyPrescriptions from '../features/pharmacy/PharmacyPrescriptions'
import PharmacyProfile from '../features/pharmacy/PharmacyProfile'
import PharmacyShell from '../features/pharmacy/PharmacyShell'
import { AuthProvider, useAuth } from '../context/AuthContext'
import RiderApp from '../features/rider/RiderApp'
import {
  getRoleHome,
  isRoleAllowed,
  USER_ROLES,
} from './roleRouting'

function AuthLoadingState() {
  return (
    <main className="route-auth-loading" aria-busy="true">
      <span>M</span>
      <strong>Opening MediConnect...</strong>
    </main>
  )
}

function ProtectedRoute({ allowedRoles, children }) {
  const { authenticated, initializing, user } = useAuth()
  const location = useLocation()

  if (initializing) {
    return <AuthLoadingState />
  }

  if (!authenticated) {
    const next = `${location.pathname}${location.search}`
    return (
      <Navigate
        to={`/?auth=login&next=${encodeURIComponent(next)}`}
        replace
      />
    )
  }

  if (!isRoleAllowed(user?.role, allowedRoles)) {
    return <Navigate to={getRoleHome(user?.role)} replace />
  }

  return children
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <div className="route-transition-shell" key={location.pathname}>
      <Routes location={location}>
          <Route path="/" element={<LandingExperience />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute allowedRoles={[USER_ROLES.CUSTOMER]}>
                <CustomerShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<CustomerApp />} />
            <Route path="search" element={<CustomerSearch />} />
            <Route path="results" element={<CustomerPharmacyResults />} />
            <Route
              path="pharmacy/:pharmacyId"
              element={<CustomerPharmacyDetail />}
            />
            <Route path="cart" element={<CustomerCart />} />
            <Route
              path="delivery-address"
              element={<CustomerDeliveryAddress />}
            />
            <Route path="checkout" element={<CustomerCheckout />} />
            <Route path="orders" element={<CustomerOrders />} />
            <Route path="orders/:orderId" element={<CustomerOrderDetail />} />
            <Route path="prescriptions" element={<CustomerPrescriptions />} />
            <Route
              path="prescriptions/:orderId"
              element={<CustomerPrescriptionDetail />}
            />
            <Route path="profile" element={<CustomerProfile />} />
          </Route>
          <Route
            path="/pharmacy"
            element={
              <ProtectedRoute allowedRoles={[USER_ROLES.PHARMACY_STAFF]}>
                <PharmacyShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<PharmacyDashboard />} />
            <Route path="inventory" element={<PharmacyInventory />} />
            <Route path="medicines" element={<PharmacyCatalogue />} />
            <Route path="orders" element={<PharmacyOrders />} />
            <Route path="orders/:orderId" element={<PharmacyOrderAction />} />
            <Route path="prescriptions" element={<PharmacyPrescriptions />} />
            <Route
              path="prescriptions/:prescriptionId"
              element={<PharmacyPrescriptionReview />}
            />
            <Route path="profile" element={<PharmacyProfile />} />
          </Route>
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={[USER_ROLES.ADMIN]}>
                <AdminShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminOverview />} />
            <Route
              path="pharmacies"
              element={<AdminBlockedPage type="pharmacies" />}
            />
            <Route
              path="inventory"
              element={<AdminBlockedPage type="inventory" />}
            />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="orders/:orderId" element={<AdminOrderDetail />} />
            <Route path="deliveries" element={<AdminDeliveries />} />
            <Route
              path="deliveries/:deliveryId"
              element={<AdminDeliveryDetail />}
            />
            <Route
              path="riders"
              element={<AdminBlockedPage type="riders" />}
            />
            <Route
              path="support"
              element={<AdminBlockedPage type="support" />}
            />
            <Route path="support/:ticketId" element={<AdminSupportDetail />} />
            <Route
              path="risk"
              element={<AdminBlockedPage type="risk" />}
            />
            <Route path="risk/:riskId" element={<AdminRiskDetail />} />
            <Route
              path="metrics"
              element={<AdminBlockedPage type="metrics" />}
            />
          </Route>
          <Route
            path="/rider"
            element={
              <ProtectedRoute allowedRoles={[USER_ROLES.DELIVERY_PARTNER]}>
                <RiderApp />
              </ProtectedRoute>
            }
          />
        </Routes>
    </div>
  )
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AnimatedRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
