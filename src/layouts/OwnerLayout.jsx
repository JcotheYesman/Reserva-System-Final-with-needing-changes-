import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import Topbar from '../components/Topbar'

const links = [
  { label: 'Overview', to: '/owner/dashboard' },
  { label: 'Facilities', to: '/owner/facilities' },
  { label: 'Reservation Requests', to: '/owner/requests' },
  { label: 'Reservation Calendar', to: '/owner/calendar' },
  { label: 'Earnings & Payments', to: '/owner/earnings' },
  { label: 'Customer Info', to: '/owner/customers' },
  { label: 'Customer Inquiries', to: '/owner/inquiries' },
]

function OwnerLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        {menuOpen ? (
          <button
            type="button"
            aria-label="Close owner navigation"
            onClick={closeMenu}
            className="fixed inset-0 z-30 bg-bg/70 md:hidden"
          />
        ) : null}
        <aside
          aria-label="Facility management navigation"
          className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform md:static md:z-auto md:translate-x-0 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <BrandLogo className="brand-logo--small" />
            <span className="rounded bg-accent/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent">
              Owner
            </span>
          </div>
          <div className="border-b border-border px-4 py-4">
            <p className="text-sm font-semibold">Facility Manager</p>
            <p className="mt-1 text-xs text-muted">Manage your venues</p>
          </div>
          <nav className="flex-1 space-y-1 p-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                className={({ isActive }) =>
                  `block rounded px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-surface hover:text-text'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            homePath="/owner/dashboard"
            notificationsPath="/owner/notifications"
            profilePath="/owner/profile"
            profileLabel="Owner Profile"
            ownerAccent
            onMenuClick={() => setMenuOpen(true)}
          />
          <main className="flex-1 p-3 sm:p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

export default OwnerLayout
