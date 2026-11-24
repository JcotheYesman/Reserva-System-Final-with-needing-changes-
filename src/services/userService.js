import { api } from './api'

export const userService = {
  async getProfile() {
    return (await api('profile.get')).data
  },
  async saveProfile(profile) {
    const saved = (await api('profile.save', { method: 'POST', body: profile })).data
    window.dispatchEvent(new Event('reserva:profile-changed'))
    window.dispatchEvent(new Event('reserva:notifications-changed'))
    return saved
  },
  async getSports() {
    return (await api('sports.list')).data
  },
  async getNotifications() {
    return (await api('notifications.list')).data
  },
  async markNotificationRead(id) {
    const result = (await api('notifications.read', { method: 'POST', body: { id } })).data
    window.dispatchEvent(new Event('reserva:notifications-changed'))
    return result
  },
  async addNotification(notification) {
    if (!notification?.title?.trim() || !notification?.message?.trim()) throw new Error('A notification title and message are required.')
    const created = (await api('notifications.create', { method: 'POST', body: notification })).data
    window.dispatchEvent(new Event('reserva:notifications-changed'))
    return created
  },
  async markAllNotificationsRead() {
    await api('notifications.read-all', { method: 'POST', body: {} })
    window.dispatchEvent(new Event('reserva:notifications-changed'))
    return true
  },
  async getReviews() {
    return (await api('reviews.list')).data
  },
  async submitReview(review) {
    return (await api('reviews.create', { method: 'POST', body: review })).data
  },
  async sendFacilityMessage(payload) {
    await api('inquiries.create', { method: 'POST', body: payload })
    return { ok: true, message: `Your message was sent to facility ${payload.facilityId}.` }
  },
}
