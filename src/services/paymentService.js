import { api, apiState } from './api'

const PAYMENT_METHODS = ['GCash', 'Maya', 'Bank']
const KEY = 'payments'
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const readPayments = async () => (await apiState.get(KEY)) ?? []

export const paymentService = {
  async createCardCheckout(reservationId) {
    if (!Number.isInteger(Number(reservationId)) || Number(reservationId) < 1) throw new Error('A valid reservation is required to start card checkout.')
    return (await api('payments.card.checkout.create', {
      method: 'POST',
      body: { reservationId: Number(reservationId) },
      timeoutMs: 30_000,
    })).data
  },
  async getCardPaymentStatus(reservationId) {
    return (await api('payments.card.status', { params: { reservationId: Number(reservationId) } })).data
  },
  async getSavedPaymentMethods() {
    return (await api('payment.methods.list')).data ?? []
  },
  async savePaymentMethod({ methodType, accountName, mobileNumber, isDefault = false }) {
    return (await api('payment.methods.save', {
      method: 'POST',
      body: { methodType, accountName, mobileNumber, isDefault },
    })).data
  },
  async setDefaultPaymentMethod(id) {
    return (await api('payment.methods.default', { method: 'POST', body: { id } })).data
  },
  async removeSavedPaymentMethod(id) {
    return (await api('payment.methods.remove', { method: 'POST', body: { id } })).data
  },
  async submitBalanceProof({ reservationId, paymentMethod, savedPaymentMethodId, paymentProof, reference = '', requestId }) {
    return (await api('payments.balance.submit', {
      method: 'POST',
      body: { reservationId, paymentMethod, savedPaymentMethodId, paymentProof, reference, requestId },
      timeoutMs: 30_000,
    })).data
  },
  async resubmitProof({ paymentId, paymentProof, reference = '' }) {
    return (await api('payments.proof.resubmit', { method: 'POST', body: { paymentId, paymentProof, reference }, timeoutMs: 30_000 })).data
  },
  async createPayment({ method, amount }) {
    if (!PAYMENT_METHODS.includes(method)) throw new Error('Choose GCash, Maya, or Bank as the payment method.')
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Payment amount must be greater than zero.')
    const payment = { id: `PAY-${crypto.randomUUID()}`, type: 'payment', method, amount: roundMoney(amount), status: 'pending', refundedAmount: 0, createdAt: new Date().toISOString() }
    await apiState.put(KEY, [payment, ...(await readPayments())])
    return payment
  },
  async linkPayment(paymentId, reservationId) {
    const payments = await readPayments()
    const index = payments.findIndex((item) => item.id === paymentId)
    if (index < 0) throw new Error('Payment record not found.')
    payments[index] = { ...payments[index], reservationId }
    await apiState.put(KEY, payments)
    return payments[index]
  },
  async getPayment(paymentId) {
    const payment = (await readPayments()).find((item) => item.id === paymentId && item.type !== 'refund')
    if (!payment) throw new Error('Payment record not found.')
    return payment
  },
  async refundPayment(reservationId, amount, details = {}) {
    if (!reservationId || !Number.isFinite(Number(amount)) || Number(amount) < 0) throw new Error('A valid reservation and refund amount are required.')
    const payments = await readPayments()
    const index = payments.findIndex((item) => item.type !== 'refund' && !item.refundId && (item.reservationId === reservationId || item.id === reservationId))
    const payment = payments[index]
    if (!payment) throw new Error('Payment record not found for this reservation.')
    const refundAmount = roundMoney(amount)
    const refundedAmount = roundMoney(payment.refundedAmount ?? 0)
    const pendingRefundAmount = roundMoney(payment.pendingRefundAmount ?? 0)
    if (refundedAmount + pendingRefundAmount + refundAmount > payment.amount) throw new Error('Refund amount cannot exceed the original payment.')
    if (payments.some((item) => item.type === 'refund' && item.reservationId === (payment.reservationId ?? payment.id) && item.status === 'completed')) {
      throw new Error('This reservation already has a completed refund.')
    }
    if (payments.some((item) => item.type === 'refund' && item.reservationId === (payment.reservationId ?? payment.id) && item.status === 'pending')) throw new Error('A refund is already awaiting payment-provider processing.')
    payments[index] = { ...payment, pendingRefundAmount: roundMoney(pendingRefundAmount + refundAmount), status: 'refund_pending' }
    const refundId = `REF-${crypto.randomUUID()}`
    const refund = {
      id: refundId, type: 'refund', refundId, reservationId: payment.reservationId ?? payment.id,
      originalPaymentId: payment.id, cancelledBy: details.cancelledBy ?? null, reason: details.reason ?? '',
      courtRefund: roundMoney(details.courtRefund ?? refundAmount), serviceFeeRefund: roundMoney(details.serviceFeeRefund ?? 0),
      totalRefunded: refundAmount, retainedByOwner: roundMoney(details.retainedByOwner ?? 0),
      retainedByPlatform: roundMoney(details.retainedByPlatform ?? 0), gatewayFeeLost: roundMoney(details.gatewayFeeLost ?? 0),
      status: 'pending', createdAt: new Date().toISOString(),
    }
    await apiState.put(KEY, [refund, ...payments])
    return refund
  },
}
