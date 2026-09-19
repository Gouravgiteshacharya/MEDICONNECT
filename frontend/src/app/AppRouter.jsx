import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { lazy, Suspense } from 'react'

import { AuthProvider, useAuth } from '../context/AuthContext'
import {
  getRoleHome,
  isRoleAllowed,
  USER_ROLES,
} from './roleRouting'

const LandingExperience = lazy(() => import('../App'))
const PrivacyPage = lazy(() => import('../pages/PrivacyPage'))
const TermsPage = lazy(() => import('../pages/TermsPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const PartnerApplicationPage = lazy(() => import('../features/partners/PartnerApplicationPage'))
const CustomerShell = lazy(() => import('../features/customer/CustomerShell'))
const CustomerApp = lazy(() => import('../features/customer/CustomerApp'))
const CustomerSearch = lazy(() => import('../features/customer/CustomerSearch'))
const CustomerPharmacyResults = lazy(() => import('../features/customer/CustomerPharmacyResults'))
const CustomerPharmacyDetail = lazy(() => import('../features/customer/CustomerPharmacyDetail'))
const CustomerCart = lazy(() => import('../features/customer/CustomerCart'))
const CustomerCheckout = lazy(() => import('../features/customer/CustomerCheckout'))
const CustomerDeliveryAddress = lazy(() => import('../features/customer/CustomerDeliveryAddress'))
const CustomerOrderDetail = lazy(() => import('../features/customer/CustomerOrderDetail'))
const CustomerOrders = lazy(() => import('../features/customer/CustomerOrders'))
const CustomerPrescriptionDetail = lazy(() => import('../features/customer/CustomerPrescriptionDetail'))
const CustomerPrescriptionUpload = lazy(() => import('../features/customer/CustomerPrescriptionUpload'))
const CustomerPrescriptions = lazy(() => import('../features/customer/CustomerPrescriptions'))
const CustomerProfile = lazy(() => import('../features/customer/CustomerProfile'))
const PharmacyShell = lazy(() => import('../features/pharmacy/PharmacyShell'))
const PharmacyDashboard = lazy(() => import('../features/pharmacy/PharmacyDashboard'))
const PharmacyInventory = lazy(() => import('../features/pharmacy/PharmacyInventory'))
const PharmacyCatalogue = lazy(() => import('../features/pharmacy/PharmacyCatalogue'))
const PharmacyOrders = lazy(() => import('../features/pharmacy/PharmacyOrders'))
const PharmacyOrderAction = lazy(() => import('../features/pharmacy/PharmacyOrderAction'))
const PharmacyPrescriptions = lazy(() => import('../features/pharmacy/PharmacyPrescriptions'))
const PharmacyPrescriptionReview = lazy(() => import('../features/pharmacy/PharmacyPrescriptionReview'))
const PharmacyProfile = lazy(() => import('../features/pharmacy/PharmacyProfile'))
const AdminShell = lazy(() => import('../features/admin/AdminShell'))
const AdminOverview = lazy(() => import('../features/admin/AdminOverview'))
const AdminPharmacies = lazy(() => import('../features/admin/AdminPharmacies'))
const AdminPharmacyDetail = lazy(() => import('../features/admin/AdminPharmacyDetail'))
const AdminPartnerApplications = lazy(() => import('../features/admin/AdminPartnerApplications'))
const AdminPartnerApplicationDetail = lazy(() => import('../features/admin/AdminPartnerApplicationDetail'))
const AdminInventory = lazy(() => import('../features/admin/AdminInventory'))
const AdminOrders = lazy(() => import('../features/admin/AdminOrders'))
const AdminOrderDetail = lazy(() => import('../features/admin/AdminOrderDetail'))
const AdminDeliveries = lazy(() => import('../features/admin/AdminDeliveries'))
const AdminDeliveryDetail = lazy(() => import('../features/admin/AdminDeliveryDetail'))
const AdminBlockedPage = lazy(() => import('../features/admin/AdminBlockedPage'))
const AdminSupportDetail = lazy(() => import('../features/admin/AdminSupportDetail'))
const AdminRiskDetail = lazy(() => import('../features/admin/AdminRiskDetail'))
const RiderApp = lazy(() => import('../features/rider/RiderApp'))

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
    const audience =
      location.pathname === '/pharmacy' ||
      location.pathname.startsWith('/pharmacy/') ||
      location.pathname === '/rider' ||
      location.pathname.startsWith('/rider/') ||
      location.pathname === '/admin' ||
      location.pathname.startsWith('/admin/')
        ? '&audience=staff'
        : ''
    return (
      <Navigate
        to={`/?auth=login${audience}&next=${encodeURIComponent(next)}`}
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
      <Suspense fallback={<AuthLoadingState />}>
      <Routes location={location}>
          <Route path="/" element={<LandingExperience />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/partner/:partnerType/apply" element={<PartnerApplicationPage />} />
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
              path="prescriptions/:prescriptionId"
              element={<CustomerPrescriptionDetail />}
            />
            <Route
              path="orders/:orderId/prescription"
              element={<CustomerPrescriptionUpload />}
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
            <Route path="pharmacies" element={<AdminPharmacies />} />
            <Route path="pharmacies/:pharmacyId" element={<AdminPharmacyDetail />} />
            <Route path="applications" element={<Navigate to="/admin/applications/pharmacies" replace />} />
            <Route path="applications/pharmacies" element={<AdminPartnerApplications type="pharmacies" />} />
            <Route path="applications/pharmacies/:applicationId" element={<AdminPartnerApplicationDetail type="pharmacies" />} />
            <Route path="applications/riders" element={<AdminPartnerApplications type="riders" />} />
            <Route path="applications/riders/:applicationId" element={<AdminPartnerApplicationDetail type="riders" />} />
            <Route path="inventory" element={<AdminInventory />} />
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
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
