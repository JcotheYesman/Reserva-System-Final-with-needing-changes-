import { useEffect, useState } from 'react'
import AppLayout from '../layouts/AppLayout'
import PublicLayout from '../layouts/PublicLayout'
import { authService } from '../services/authService'

function FacilitiesLayout() {
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

  return user ? <AppLayout /> : <PublicLayout />
}

export default FacilitiesLayout
