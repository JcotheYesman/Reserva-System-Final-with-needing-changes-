import { api } from './api'

let presenceClientId = null

function getPresenceClientId() {
  presenceClientId ??= crypto.randomUUID()
  return presenceClientId
}

function notifySessionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('reserva:session-changed'))
  }
}

export const authService = {
  startSocialLogin(provider, returnTo = '/dashboard', intent = 'login') {
    if (provider !== 'google') throw new Error('Google sign-in is the only available social sign-in option.')
    if (!['login', 'signup'].includes(intent)) throw new Error('Choose login or registration before continuing.')
    const flowId = crypto.randomUUID()
    window.sessionStorage.setItem('reserva.oauth.flow', flowId)
    window.sessionStorage.setItem('reserva.oauth.intent', intent)
    const url = new URL(import.meta.env.VITE_API_URL || '/api/index.php', window.location.origin)
    url.searchParams.set('action', 'auth.oauth.start')
    url.searchParams.set('provider', provider)
    url.searchParams.set('returnTo', returnTo)
    url.searchParams.set('flowId', flowId)
    url.searchParams.set('intent', intent)
    window.location.assign(url.toString())
  },

  async completeSocialLogin(ticket, flowId, intent) {
    const result = await api('auth.oauth.finish', { method: 'POST', body: { ticket, flowId, intent } })
    notifySessionChanged()
    return result
  },

  async login(payload) {
    const result = await api('auth.login', { method: 'POST', body: payload })
    notifySessionChanged()
    return result
  },

  async signUp(payload) {
    const result = await api('auth.signup', { method: 'POST', body: payload })
    notifySessionChanged()
    return result
  },

  async getSession() {
    return (await api('auth.session')).user
  },

  startPresenceTracking() {
    if (typeof window === 'undefined') return () => {}
    const service = this
    const clientId = getPresenceClientId()
    let active = true
    let hasSession = false
    let generation = 0
    let heartbeatTimer = null

    function stopHeartbeat() {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    function sendHeartbeat() {
      if (!active || !hasSession) return
      api('presence.heartbeat', {
        method: 'POST',
        body: { clientId },
        timeoutMs: 10_000,
      }).catch((error) => {
        if (error?.status === 401) {
          hasSession = false
          stopHeartbeat()
        }
      })
    }

    function leavePresence() {
      if (!hasSession) return
      hasSession = false
      stopHeartbeat()
      api('presence.leave', {
        method: 'POST',
        body: { clientId },
        keepalive: true,
      }).catch(() => {})
    }

    async function syncSession() {
      const currentGeneration = ++generation
      hasSession = false
      stopHeartbeat()
      try {
        const user = await service.getSession()
        if (!active || currentGeneration !== generation || !user) return
        hasSession = true
        sendHeartbeat()
        heartbeatTimer = window.setInterval(sendHeartbeat, 30_000)
      } catch {
        // Sign-in changes and the next app load will retry presence setup.
      }
    }

    const handleSessionChange = () => { void syncSession() }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') sendHeartbeat()
    }
    const handlePageHide = () => leavePresence()

    window.addEventListener('reserva:session-changed', handleSessionChange)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void syncSession()

    return () => {
      active = false
      generation += 1
      hasSession = false
      stopHeartbeat()
      window.removeEventListener('reserva:session-changed', handleSessionChange)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  },

  async logout() {
    try {
      return await api('auth.logout', { method: 'POST', body: { clientId: presenceClientId } })
    } finally {
      notifySessionChanged()
    }
  },

  async recover() {
    return api('auth.recover', { method: 'POST', body: {} })
  },
}
