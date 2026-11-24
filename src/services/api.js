const API_URL = import.meta.env.VITE_API_URL || '/api/index.php'

function apiError(message, code, status) {
  const error = new Error(message)
  error.code = code
  if (status !== undefined) error.status = status
  return error
}

export async function api(action, { method = 'GET', params = {}, body, timeoutMs = 0, keepalive = false } = {}) {
  const url = new URL(API_URL, window.location.origin)
  url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value)
  }
  let response
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      keepalive,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw apiError('Could not reach the Reserva backend. Start the app with `npm run dev` and check that MySQL is running.', 'NETWORK_ERROR')
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw apiError('The request timed out before the server response arrived.', 'REQUEST_TIMEOUT')
    }
    throw error
  }
  if (response.status === 502) {
    throw apiError('The PHP backend is not running. Restart the app with `npm run dev` to start the frontend and backend together.', 'SERVER_UNAVAILABLE', response.status)
  }
  const result = await response.json().catch(() => null)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw apiError('The server returned an unreadable response.', 'INVALID_RESPONSE', response.status)
  }
  if (!response.ok) {
    throw apiError(result.error || result.message || `Request failed (${response.status}).`, 'HTTP_ERROR', response.status)
  }
  return result
}

export const apiState = {
  async get(key) {
    return (await api('state.get', { params: { key } })).data
  },
  async put(key, value) {
    const result = await api('state.put', { method: 'POST', body: { key, value } })
    return result.data ?? value
  },
  async list(key) {
    return (await api('state.list', { params: { key } })).data
  },
}
