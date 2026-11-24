import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import LandingPage from '../pages/LandingPage'
import { authService } from '../services/authService'
import { accountHomePath } from '../utils/accountRoutes'

function HomeRoute() {
  const [user, setUser] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let active = true
    authService.getSession()
      .then((currentUser) => {
        if (active) setUser(currentUser)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setCheckingSession(false)
      })
    return () => { active = false }
  }, [])

  if (checkingSession) {
    return <div role="status" className="p-6 text-center text-sm text-muted">Checking your session…</div>
  }
  if (!user) return <LandingPage />

  return <Navigate to={accountHomePath(user)} replace />
}

export default HomeRoute
