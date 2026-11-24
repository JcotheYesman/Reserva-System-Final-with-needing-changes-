import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { authService } from '../services/authService'

function BookingRoute() {
  const location = useLocation()
  const [authenticated, setAuthenticated] = useState(null)

  useEffect(() => {
    let active = true
    authService.getSession()
      .then((user) => active && setAuthenticated(Boolean(user)))
      .catch(() => active && setAuthenticated(false))
    return () => { active = false }
  }, [])

  if (authenticated === null) return <div role="status" className="p-6 text-center text-sm text-muted">Checking your session…</div>
  if (!authenticated) {
    return <Navigate to="/auth/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return <Outlet />
}

export default BookingRoute
