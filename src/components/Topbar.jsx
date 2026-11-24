import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandLogo from './BrandLogo'
import { authService } from '../services/authService'
import { userService } from '../services/userService'

function Topbar({
  name: nameOverride,
  onMenuClick,
  homePath = '/dashboard',
  notificationsPath = '/notifications',
  profilePath = '/profile',
  profileLabel = 'User Profile',
  workspaceLabel = '',
  ownerAccent = false,
  adminAccent = false,
}) {
  const [accountName, setAccountName] = useState('')
  const [profilePicture, setProfilePicture] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const navigate = useNavigate()
  const name = nameOverride || accountName || 'Account'
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  useEffect(() => {
    let active = true

    function loadAccount() {
      userService.getProfile()
        .then((profile) => {
          if (active) {
            setAccountName(profile?.name?.trim() || profile?.email?.split('@')[0] || 'Account')
            setProfilePicture(profile?.profilePicture || '')
          }
        })
        .catch(() => {
          authService.getSession()
            .then((user) => {
              if (!active) return
              setAccountName(user?.name?.trim() || user?.email?.split('@')[0] || 'Account')
            })
            .catch(() => {
              if (active) setAccountName('Account')
            })
        })
    }

    function loadUnreadCount() {
      userService.getNotifications()
        .then((notifications) => {
          if (active) setUnreadCount(notifications.filter((item) => item.unread).length)
        })
        .catch(() => {
          if (active) setUnreadCount(0)
        })
    }

    loadAccount()
    loadUnreadCount()
    const notificationTimer = window.setInterval(loadUnreadCount, 20_000)
    const refreshNotificationsOnFocus = () => {
      if (document.visibilityState === 'visible') loadUnreadCount()
    }
    window.addEventListener('reserva:profile-changed', loadAccount)
    window.addEventListener('reserva:notifications-changed', loadUnreadCount)
    document.addEventListener('visibilitychange', refreshNotificationsOnFocus)
    return () => {
      active = false
      window.clearInterval(notificationTimer)
      window.removeEventListener('reserva:profile-changed', loadAccount)
      window.removeEventListener('reserva:notifications-changed', loadUnreadCount)
      document.removeEventListener('visibilitychange', refreshNotificationsOnFocus)
    }
  }, [])

  useEffect(() => {
    if (!profileMenuOpen) return undefined

    function handlePointerDown(event) {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [profileMenuOpen])

  async function signOut() {
    setProfileMenuOpen(false)
    try {
      await authService.logout()
    } finally {
      navigate('/')
    }
  }

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-bg px-3 sm:px-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={onMenuClick}
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-text md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <BrandLogo to={homePath} label={`RESERVA ${workspaceLabel || 'dashboard'}`} className="brand-logo--small topbar-brand" />
        {workspaceLabel ? <span className="hidden text-xs text-muted sm:inline">{workspaceLabel}</span> : null}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Link
          to={notificationsPath}
          aria-label={unreadCount ? `View notifications, ${unreadCount} unread` : 'View notifications'}
          className="relative rounded p-1.5 text-muted hover:bg-surface hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
          {unreadCount > 0 ? <span aria-hidden="true" className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${adminAccent ? 'bg-info' : ownerAccent ? 'bg-accent' : 'bg-success'}`} /> : null}
        </Link>
        <div ref={profileMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-full text-sm text-text hover:opacity-90"
          >
            <span className="hidden sm:inline">{name}</span>
            <span className={`grid h-8 w-8 place-items-center overflow-hidden rounded-full text-xs font-bold ${adminAccent ? 'bg-info text-white' : ownerAccent ? 'bg-accent text-white' : 'bg-success text-bg'}`}>
              {profilePicture ? (
                <img src={profilePicture} alt="" className="h-full w-full object-cover" />
              ) : initials}
            </span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
              className={`hidden h-3.5 w-3.5 text-muted transition-transform sm:block ${profileMenuOpen ? 'rotate-180' : ''}`}
            >
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </button>
          {profileMenuOpen ? (
            <div
              role="menu"
              aria-label="Account menu"
              className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-xl"
            >
              <Link
                to={profilePath}
                role="menuitem"
                onClick={() => setProfileMenuOpen(false)}
                className="block px-4 py-2.5 text-sm text-text transition-colors hover:bg-sidebar"
              >
                {profileLabel}
              </Link>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-danger transition-colors hover:bg-sidebar"
              >
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

export default Topbar
