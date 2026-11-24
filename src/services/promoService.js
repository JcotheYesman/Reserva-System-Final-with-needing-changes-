import { api } from './api'

export const promoService = {
  async listAdminPromos() {
    return (await api('admin.promos.list')).data ?? []
  },

  async generateAdminPromo(payload) {
    return (await api('admin.promos.generate', { method: 'POST', body: payload })).data
  },

  async validatePromoCode(code, bookingAmount) {
    return (await api('promo.validate', {
      params: { code: String(code).trim().toUpperCase(), bookingAmount },
    })).data
  },
}
