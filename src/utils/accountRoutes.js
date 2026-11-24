export function accountHomePath(user) {
  if (user?.role === 'Admin') return '/admin'
  if (user?.role === 'Facility Owner') return '/owner/dashboard'
  return '/dashboard'
}
