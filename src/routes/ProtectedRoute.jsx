import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { authService } from '../services/authService'
import { accountHomePath } from '../utils/accountRoutes'

function ProtectedRoute({ allowedRoles }) {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    let active = true
    authService.getSession()
      .then((currentUser) => active && setUser(currentUser ?? null))
      .catch(() => active && setUser(null))
    return () => { active = false }
  }, [])

  if (user === undefined) return <div role="status" className="p-6 text-center text-sm text-muted">Checking your session…</div>
  if (!user) return <Navigate to="/auth/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to={accountHomePath(user)} replace />
  return <Outlet />
}

export default ProtectedRoute
