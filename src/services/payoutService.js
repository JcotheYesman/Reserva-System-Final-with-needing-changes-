import { api, apiState } from './api'
import { authService } from './authService'
import { calculateBookingFees, calculateWithdrawal } from '../utils/fees'
import { settingsService } from './settingsService'

const KEYS = { earnings: 'owner.earnings', payouts: 'owner.payouts', accounts: 'owner.payoutAccounts', refunds: 'owner.refunds' }
const read = async (key) => (await apiState.get(key)) ?? []
const write = (key, value) => apiState.put(key, value)
const all = async (key) => (await apiState.list(key)).flatMap((value) => Array.isArray(value) ? value : [])
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

function normalizeEarnings(earnings, disputeWindowHours = 48) {
  const now = new Date()
  return earnings.map((earning) => {
    const releaseTime = earning.releaseAt
      ? new Date(earning.releaseAt).getTime()
      : new Date(`${String(earning.date ?? '').slice(0, 10)}T23:59:59`).getTime() + Number(disputeWindowHours) * 60 * 60 * 1000
    const paymentSettled = ['No-show', 'Cancelled'].includes(earning.reservationStatus)
      ? Number(earning.ownerNet) > 0
      : !earning.paymentStatus || earning.paymentStatus === 'paid'
    const canRelease = Number.isFinite(releaseTime) && releaseTime <= now.getTime() && paymentSettled
    return {
      ...earning,
      status: earning.status === 'Refunded' || earning.paymentStatus === 'refunded' ? 'Refunded'
        : earning.reservationStatus === 'Cancelled' && Number(earning.ownerNet) <= 0 ? 'Cancelled'
          : earning.reservationStatus === 'No-show' && Number(earning.ownerNet) <= 0 ? 'No-show'
            : earning.reservationStatus === 'Disputed' ? 'Disputed'
              : ['Completed', 'No-show', 'Cancelled'].includes(earning.reservationStatus) && canRelease ? 'Available' : 'Pending',
    }
  })
}

function balance(earnings, payouts) {
  const available = earnings.filter((item) => item.status === 'Available').reduce((sum, item) => sum + Number(item.ownerNet), 0)
  const held = payouts.filter((item) => ['Requested', 'Processing', 'Paid'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0)
  const fees = payouts.filter((item) => item.status === 'Failed').reduce((sum, item) => sum + Number(item.fee), 0)
  return {
    available: round(available - held - fees),
    pending: round(earnings.filter((item) => ['Pending', 'Disputed'].includes(item.status)).reduce((sum, item) => sum + Number(item.ownerNet), 0)),
    earned: round(earnings.filter((item) => item.status !== 'Refunded' && (
      ['Completed', 'No-show', 'Cancelled', 'Disputed'].includes(item.reservationStatus) || ['Available', 'Disputed'].includes(item.status)
    )).reduce((sum, item) => sum + Number(item.ownerNet), 0)),
    withdrawn: round(payouts.filter((item) => item.status === 'Paid').reduce((sum, item) => sum + Number(item.net), 0)),
  }
}

export const payoutService = {
  async getBalance() {
    const [earnings, payouts, settings] = await Promise.all([read(KEYS.earnings), read(KEYS.payouts), settingsService.getSettings()])
    return balance(normalizeEarnings(earnings, settings.refundPolicy.disputeWindowHours), payouts)
  },
  async getEarnings() {
    const [earnings, settings] = await Promise.all([read(KEYS.earnings), settingsService.getSettings()])
    return normalizeEarnings(earnings, settings.refundPolicy.disputeWindowHours)
  },
  async reconcileCompletedReservations(reservations) {
    const completionStatuses = new Map(reservations
      .filter((reservation) => ['Completed', 'No-show'].includes(reservation.status))
      .map((reservation) => [String(reservation.id), reservation.status]))
    if (!completionStatuses.size) return

    const earnings = await read(KEYS.earnings)
    let changed = false
    const reconciled = earnings.map((earning) => {
      if (!completionStatuses.has(String(earning.reservationId)) ||
        ['Completed', 'No-show'].includes(earning.reservationStatus) ||
        earning.reservationStatus === 'Disputed') return earning
      changed = true
      return { ...earning, reservationStatus: completionStatuses.get(String(earning.reservationId)) }
    })
    if (changed) await write(KEYS.earnings, reconciled)
  },
  async getPayouts() { return read(KEYS.payouts) },
  async getPayoutAccounts() { return read(KEYS.accounts) },
  async getPlatformFinancialData() {
    const [earnings, payouts, refunds] = await Promise.all([all(KEYS.earnings), all(KEYS.payouts), all(KEYS.refunds)])
    const settings = await settingsService.getSettings()
    return { earnings: normalizeEarnings(earnings.map((item) => ({ ...item, serviceFee: item.serviceFee ?? calculateBookingFees(item.courtRate).serviceFee })), settings.refundPolicy.disputeWindowHours), payouts, refunds }
  },
  async getAdminPayouts() { return all(KEYS.payouts) },
  async addPayoutAccount({ type, name, number, password }) {
    if (!['GCash', 'Maya', 'Bank'].includes(type)) throw new Error('Choose GCash, Maya, or Bank as the payout account type.')
    if (!name?.trim() || !/^[\d -]{8,24}$/.test(number?.trim() ?? '')) throw new Error('Enter the account holder name and a valid account number.')
    if (!password) throw new Error('Enter your RESERVA account password to continue.')
    return (await api('owner.payout.account.add', { method: 'POST', body: { type, name: name.trim(), number: number.trim(), password } })).data
  },
  async requestWithdrawal({ amount, accountId }) {
    const accounts = await read(KEYS.accounts)
    const account = accounts.find((item) => item.id === accountId && item.verified)
    if (!account) throw new Error('Choose a verified payout account before withdrawing.')
    const settings = await settingsService.getFees()
    const calc = calculateWithdrawal(amount, (await this.getBalance()).available, settings)
    if (!calc.valid) throw new Error(calc.reason)
    const user = await authService.getSession()
    const payout = { id: `PO-${crypto.randomUUID()}`, ownerId: user.id, requestedAt: new Date().toISOString(), amount: round(amount), fee: calc.fee, net: calc.net, accountId, destination: `${account.type} ···· ${account.number.slice(-4)}`, status: 'Requested' }
    await write(KEYS.payouts, [payout, ...(await read(KEYS.payouts))])
    return payout
  },
  async updatePayoutStatus(id, status, reason = '') {
    if (!['Processing', 'Paid', 'Failed'].includes(status)) throw new Error('Choose a supported payout status.')
    const payouts = await read(KEYS.payouts)
    const index = payouts.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('Payout request not found.')
    const current = payouts[index].status
    if (!(status === 'Processing' && current === 'Requested' || status === 'Paid' && current === 'Processing' || status === 'Failed' && ['Requested', 'Processing'].includes(current))) throw new Error(`A payout cannot move from ${current} to ${status}.`)
    if (status === 'Failed' && !reason.trim()) throw new Error('Add a reason for the failed payout.')
    payouts[index] = { ...payouts[index], status, reason: status === 'Failed' ? reason.trim() : '' }
    await write(KEYS.payouts, payouts)
    return payouts[index]
  },
  async recordBookingEarning(reservation) {
    if (Number.isInteger(Number(reservation.ownerId)) && Number(reservation.ownerId) > 0) {
      const result = await api('financial.earning', { method: 'POST', body: { reservation } })
      if (result.data) return result.data
    }
    if (!reservation.ownerId) return null
    const earning = { id: `E-${reservation.id}`, ownerId: reservation.ownerId, reservationId: reservation.id, date: reservation.date, user: reservation.user, facility: reservation.name, courtRate: reservation.courtRate, serviceFee: reservation.serviceFee, ownerCommission: reservation.ownerCommission, ownerNet: reservation.ownerNet, status: 'Pending', reservationStatus: reservation.status }
    await write(KEYS.earnings, [earning, ...(await read(KEYS.earnings))])
    return earning
  },
  async updateReservationEarning(reservationId, reservationStatus) {
    const earnings = await read(KEYS.earnings)
    const index = earnings.findIndex((item) => item.reservationId === reservationId)
    if (index < 0) return null
    earnings[index] = { ...earnings[index], reservationStatus }
    await write(KEYS.earnings, earnings)
    return earnings[index]
  },
  async updateOwnerIdForEarning(reservationId, ownerId) {
    const earnings = await read(KEYS.earnings)
    const index = earnings.findIndex((item) => item.reservationId === reservationId)
    if (index < 0) return null
    earnings[index] = { ...earnings[index], ownerId }
    await write(KEYS.earnings, earnings)
    return earnings[index]
  },
  async recordRefund(reservationId, amount, ownerId) {
    const details = typeof amount === 'object' ? amount : { totalRefunded: round(amount) }
    const refund = { id: details.refundId ?? `RF-${crypto.randomUUID()}`, reservationId, ownerId, ...details, amount: round(details.totalRefunded), status: 'pending', createdAt: new Date().toISOString() }
    await write(KEYS.refunds, [refund, ...(await read(KEYS.refunds))])
    return refund
  },
  async holdEarningForDispute(reservationId, isDisputed = true) {
    return (await api('financial.hold', { method: 'POST', body: { reservationId, isDisputed } })).data
  },
}
