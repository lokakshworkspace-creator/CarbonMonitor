/**
 * Shell for the dashboard: persistent sidebar navigation, plus a live
 * gateway-connection indicator in the header so it is always obvious
 * whether what you are looking at is live or stale.
 *
 * The whole site is now login-gated: visiting "/" with no session goes to
 * /login, and with a session goes straight to the caller's role landing
 * page (/admin or /dashboard) - see RootRedirect below. This is a
 * deliberate reversal of the original Phase 7 decision to leave the five
 * original pages (Overview, Real-Time Data, Verification, Blockchain
 * Logs, System Monitor) public; they now sit behind the same RequireAuth
 * guard as everything else (any authenticated role), just without a role
 * restriction narrower than "logged in". Their own components are
 * untouched - only the routing around them changed, including moving
 * Overview off "/" to "/overview" since "/" is now a pure redirect route.
 * /login still renders outside the sidebar shell; everything else, old
 * and new, renders inside it.
 *
 * Routing is client-side only (react-router-dom); the gateway serves no
 * HTML, it only serves the REST + WebSocket API this app consumes.
 */

import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'

import AppFooter from './components/AppFooter.jsx'
import ConnectionStatus from './components/ConnectionStatus.jsx'
import { HeroScene } from './components/icons.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import { useAuth } from './context/authContext.js'
import AdminAuditLog from './pages/admin/AdminAuditLog.jsx'
import AdminBlockchainStatus from './pages/admin/AdminBlockchainStatus.jsx'
import AdminFactoriesDevices from './pages/admin/AdminFactoriesDevices.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import AdminRegions from './pages/admin/AdminRegions.jsx'
import AdminSystemHealth from './pages/admin/AdminSystemHealth.jsx'
import AdminUsers from './pages/admin/AdminUsers.jsx'
import BlockchainLogs from './pages/BlockchainLogs.jsx'
import ChangePassword from './pages/ChangePassword.jsx'
import FactoryDetail from './pages/dashboard/FactoryDetail.jsx'
import RegionalDashboard from './pages/dashboard/RegionalDashboard.jsx'
import Login from './pages/Login.jsx'
import Overview from './pages/Overview.jsx'
import RealTimeData from './pages/RealTimeData.jsx'
import SystemMonitor from './pages/SystemMonitor.jsx'
import Verification from './pages/Verification.jsx'

// Decorative factory-into-leaves scene behind every signed-in page, the same
// artwork as the login page (see styles.css's ".app-bg" block). Purely visual:
// set this to false to go back to the plain dark background - nothing else
// needs to change.
const SHOW_APP_BACKGROUND = true

// Overview moved from "/" to "/overview" - see the module docstring.
const NAV_ITEMS = [
  { to: '/overview', label: 'Overview' },
  { to: '/realtime', label: 'Real-Time Data' },
  { to: '/verification', label: 'Verification' },
  { to: '/blockchain', label: 'Blockchain Logs' },
  { to: '/system', label: 'System Monitor' },
]

// "/" is a pure redirect gate, same logic RequireAuth uses when a logged-in
// user's role doesn't match a route: no session -> /login, otherwise the
// caller's own role landing page. It never renders content itself.
function RootRedirect() {
  const { user } = useAuth()
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />
}

function AuthNav() {
  const { user, logout } = useAuth()

  if (!user) {
    return (
      <nav className="nav-secondary">
        <NavLink to="/login" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          Login
        </NavLink>
      </nav>
    )
  }

  return (
    <nav className="nav-secondary">
      {user.role === 'admin' && (
        <NavLink to="/admin" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          Admin Panel
        </NavLink>
      )}
      {/* Admin can view the Regional Head dashboard too, per the brief. */}
      <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
        {user.role === 'admin' ? 'Regional Dashboard' : 'Dashboard'}
      </NavLink>
      {/* Self-service, available to both roles - see ChangePassword.jsx. */}
      <NavLink to="/change-password" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
        Change Password
      </NavLink>
      <button type="button" className="nav-link nav-logout" onClick={logout}>
        Log out ({user.username})
      </button>
    </nav>
  )
}

function Shell() {
  const { user, checking } = useAuth()
  // The sidebar (nav, bell, connection status) is only for a signed-in user whose
  // session the gateway has confirmed - never for a visitor with no session, nor
  // while a restored token is still being checked (see AuthProvider.jsx).
  const signedIn = user !== null && !checking
  return (
    <div className="app">
      {SHOW_APP_BACKGROUND && signedIn && (
        <div className="app-bg" aria-hidden="true">
          <HeroScene className="app-bg-svg" preserveAspectRatio="xMidYMax meet" />
          <div className="app-bg-scrim" />
        </div>
      )}
      {signedIn && (
      <aside className="sidebar">
        {/* Hero background sits behind .brand only, faded back to the
            sidebar's own solid panel color before the nav links below -
            see styles.css's .hero-banner.is-sidebar and icons.jsx's
            HeroScene docstring. */}
        <div className="brand hero-banner is-sidebar">
          <HeroScene className="hero-banner-svg" />
          <div className="hero-banner-scrim" />
          <div className="brand-mark">CO₂</div>
          <div>
            <div className="brand-title">Carbon Monitor</div>
            <div className="brand-subtitle">Blockchain + IoT</div>
          </div>
          <NotificationBell />
        </div>

        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <AuthNav />

        <div className="sidebar-footer">
          <ConnectionStatus />
          <AppFooter compact />
        </div>
      </aside>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          <Route
            element={
              <RequireAuth roles={['admin', 'regional_head']}>
                <Outlet />
              </RequireAuth>
            }
          >
            <Route path="/overview" element={<Overview />} />
            <Route path="/realtime" element={<RealTimeData />} />
            <Route path="/verification" element={<Verification />} />
            <Route path="/blockchain" element={<BlockchainLogs />} />
            <Route path="/system" element={<SystemMonitor />} />
            <Route path="/change-password" element={<ChangePassword />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireAuth roles={['admin']}>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="regions" element={<AdminRegions />} />
            <Route path="factories" element={<AdminFactoriesDevices />} />
            <Route path="system-health" element={<AdminSystemHealth />} />
            <Route path="blockchain-status" element={<AdminBlockchainStatus />} />
            <Route path="audit-log" element={<AdminAuditLog />} />
          </Route>

          <Route
            path="/dashboard"
            element={
              <RequireAuth roles={['admin', 'regional_head']}>
                <Outlet />
              </RequireAuth>
            }
          >
            <Route index element={<RegionalDashboard />} />
            <Route path="factories/:factoryId" element={<FactoryDetail />} />
          </Route>
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  )
}
