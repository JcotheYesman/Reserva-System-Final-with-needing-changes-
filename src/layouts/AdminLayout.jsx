import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import Topbar from '../components/Topbar'

const links = [
  { label: 'Dashboard', to: '/admin' },
  { label: 'Facility Applications', to: '/admin/applications' },
  { label: 'User Management', to: '/admin/users' },
  { label: 'Sports Facilities', to: '/admin/facilities' },
  { label: 'Reports', to: '/admin/reports' },
  { label: 'Announcements', to: '/admin/announcements' },
  { label: 'Payment Records', to: '/admin/payments' },
  { label: 'Revenue & Payouts', to: '/admin/revenue' },
  { label: 'Fees & Refund Policy', to: '/admin/settings' },
]

function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        {menuOpen ? (
          <button type="button" aria-label="Close admin navigation" onClick={closeMenu} className="fixed inset-0 z-30 bg-bg/70 md:hidden" />
        ) : null}
        <aside aria-label="Admin navigation" className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform md:static md:z-auto md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <BrandLogo className="brand-logo--small" />
            <span className="rounded bg-info/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-info">Admin</span>
          </div>
          <div className="border-b border-border px-4 py-4">
            <p className="text-sm font-semibold">RESERVA Admin</p>
            <p className="mt-1 text-xs text-muted">Platform management</p>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/admin'}
                onClick={closeMenu}
                className={({ isActive }) => `block rounded px-3 py-2 text-sm transition-colors ${isActive ? 'bg-info/10 font-semibold text-info' : 'text-muted hover:bg-surface hover:text-text'}`}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            homePath="/admin"
            notificationsPath="/admin/notifications"
            profilePath="/admin/profile"
            profileLabel="Admin Profile"
            adminAccent
            onMenuClick={() => setMenuOpen(true)}
          />
          <main className="flex-1 p-3 sm:p-5"><Outlet /></main>
        </div>
      </div>
    </div>
  )
}

export default AdminLayout
