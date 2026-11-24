import { api, apiState } from './api'
import { reservationService } from './reservationService'
import { userService } from './userService'

const clone = (value) => structuredClone(value)
const own = (key) => apiState.get(`owner.${key}`)
const save = (key, value) => apiState.put(`owner.${key}`, value)

export const ownerService = {
  async getProfile() {
    const profile = await userService.getProfile()
    const fullName = typeof profile?.name === 'string' ? profile.name.trim() : ''
    const [firstName = '', ...lastNames] = fullName.split(/\s+/)
    return { ...profile, firstName, lastName: lastNames.join(' '), address: typeof profile?.address === 'string' ? profile.address : '' }
  },
  async saveProfile(profile) {
    const name = [profile.firstName, profile.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
    const saved = await userService.saveProfile({ ...profile, name })
    return { ...saved, firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), address: saved.address ?? profile.address }
  },
  async registerOwnerAccount(account) {
    if (!account.fullName?.trim() || !account.email?.trim() || !account.password) throw new Error('Owner account details are incomplete.')
    return api('owner.register', { method: 'POST', body: account })
  },
  async getApplicationDraft() { return own('applicationDraft') },
  async saveApplicationDraft(draft) { await save('applicationDraft', draft); return clone(draft) },
  async submitApplication(application) {
    const submitted = await save('application', application)
    window.dispatchEvent(new Event('reserva:profile-changed'))
    return submitted
  },
  async getApplicationStatus() { return own('application') },
  async getCustomers() {
    const reservations = await this.getReservations()
    const byCustomer = new Map()
    reservations.forEach((item) => {
      const id = Number(item.userId)
      if (!Number.isInteger(id) || id < 1) return
      const customer = byCustomer.get(id) ?? {
        id,
        name: item.customer || item.user || 'Player',
        email: item.email ?? '',
        totalBookings: 0,
        lastBooking: '',
        lastBookingTimestamp: 0,
      }
      customer.totalBookings += 1
      const bookingTimestamp = new Date(`${item.date}T${item.startTime ?? '00:00'}:00`).getTime()
      if (Number.isFinite(bookingTimestamp) && bookingTimestamp > customer.lastBookingTimestamp) {
        customer.lastBooking = item.date
        customer.lastBookingTimestamp = bookingTimestamp
      }
      byCustomer.set(id, customer)
    })
    return [...byCustomer.values()]
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        totalBookings: customer.totalBookings,
        lastBooking: customer.lastBooking,
      }))
      .sort((first, second) => first.name.localeCompare(second.name))
  },
  async getCustomerInquiries() { return (await api('owner.inquiries.list')).data },
  async markInquiryRead(id) {
    return api('owner.inquiry.read', { method: 'POST', body: { id } })
  },
  async replyToInquiry(id, text) {
    return (await api('owner.inquiry.reply', { method: 'POST', body: { id, text } })).data
  },
  async getDashboard() {
    const [facilities, reservations] = await Promise.all([this.getFacilities(), this.getReservations()])
    const pending = reservations.filter((item) => item.status === 'Pending').length
    const confirmed = reservations.filter((item) => item.status === 'Confirmed').length
    const revenue = reservations.filter((item) => item.status === 'Confirmed').reduce((sum, item) => sum + Number(item.total ?? 0), 0)
    return { stats: [
      { label: 'Facilities', value: facilities.filter((item) => item.active).length, detail: 'Active listings' },
      { label: 'Reservation requests', value: pending, detail: 'Awaiting your response' },
      { label: 'Confirmed bookings', value: confirmed, detail: 'Across your facilities' },
      { label: 'Confirmed revenue', value: `₱${new Intl.NumberFormat('en-PH').format(revenue)}`, detail: 'Confirmed booking total' },
    ], requests: reservations.slice(0, 5) }
  },
  async getFacilities() { return (await api('facilities.manage.list')).data },
  async updateFacility(id, changes) {
    const current = (await this.getFacilities()).find((item) => item.id === Number(id))
    if (!current) throw new Error('Facility not found.')
    const priceRate = changes.price === undefined ? undefined : Number(String(changes.price).replace(/[^\d.]/g, ''))
    const hourlyRate = changes.hourlyRate ?? (Number.isFinite(priceRate) ? priceRate : current.hourlyRate)
    return (await api('facilities.update', { method: 'POST', body: { ...current, ...changes, hourlyRate, ownerId: changes.owner?.id ?? current.ownerId, id: Number(id) } })).data
  },
  async createFacility(facility) {
    return (await api('facilities.create', { method: 'POST', body: { ...facility, active: facility.active ?? true } })).data
  },
  async removeFacility(id, reason) {
    return (await api('facilities.remove', { method: 'POST', body: { id, reason } })).data
  },
  async getReservations() {
    const reservations = await reservationService.getOwnerReservations()
    return reservations.map((reservation) => ({
      ...reservation,
      customer: reservation.customer || reservation.user || 'Player',
      facility: reservation.facility || reservation.name || 'Facility unavailable',
      total: reservation.total ?? reservation.userTotal ?? reservation.courtRate ?? 0,
    }))
  },
  async getEarnings() { return (await own('earnings')) ?? [] },
  async updateReservationStatus(id, status, reason = '') { return reservationService.updateOwnerReservationStatus(id, status, reason) },
  async recordOwnerCancellation(ownerId = 'owner') {
    const counts = (await own('cancellations')) ?? {}
    counts[ownerId] = Number(counts[ownerId] ?? 0) + 1
    await save('cancellations', counts)
    return counts[ownerId]
  },
  async getOwnerCancellationCount(ownerId = 'owner') { return Number(((await own('cancellations')) ?? {})[ownerId] ?? 0) },
}
