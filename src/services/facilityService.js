import { api } from './api'

export const facilityService = {
  async getSports() {
    return (await api('sports.list')).data
  },
  async createSport(name) {
    return (await api('sports.create', { method: 'POST', body: { name } })).data
  },
  async updateSport(id, name) {
    return (await api('sports.update', { method: 'POST', body: { id, name } })).data
  },
  async deleteSport(id) {
    return api('sports.delete', { method: 'POST', body: { id } })
  },
  async updateSportColor(id, color) {
    return (await api('sports.color.update', { method: 'POST', body: { id, color } })).data
  },
  async getAmenities() {
    return (await api('amenities.list')).data
  },
  async getFacilities() {
    return (await api('facilities.list')).data
  },
  async searchFacilities({ query = '', category = 'All' } = {}) {
    return (await api('facilities.list', { params: { query, category } })).data
  },
  async getFacilityById(id) {
    return (await api('facilities.get', { params: { id } })).data
  },
  async getAvailability(facilityId, date, excludeReservationId, manage = false) {
    return (await api('facilities.availability', { params: { facilityId, date, excludeReservationId, manage: manage ? 1 : undefined } })).data
  },
  async updateAvailability({ facilityId, courtNumber, date, changes, blockDate = false, reason = '' }) {
    return (await api('facilities.availability.update', {
      method: 'POST',
      body: { facilityId, courtNumber, date, changes, blockDate, reason },
    })).data
  },
}
