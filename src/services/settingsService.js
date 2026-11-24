import { FEES, REFUND_POLICY } from '../config/fees'
import { apiState } from './api'

const SETTINGS_KEY = 'platform.fees'
const defaults = () => ({ fees: { ...FEES }, refundPolicy: { ...REFUND_POLICY } })

function validateFees(fees) {
  for (const key of ['userServiceRate', 'ownerCommissionRate']) {
    if (!Number.isFinite(Number(fees[key])) || Number(fees[key]) < 0 || Number(fees[key]) > 1) throw new Error(`${key} must be between 0 and 1.`)
  }
  for (const key of ['userServiceMin', 'withdrawalFee', 'minWithdrawal']) {
    if (!Number.isFinite(Number(fees[key])) || Number(fees[key]) < 0) throw new Error(`${key} must be a non-negative amount.`)
  }
  if (!['on-request', 'weekly'].includes(fees.payoutSchedule)) throw new Error('Payout schedule must be on-request or weekly.')
}

function validateRefundPolicy(policy) {
  for (const key of ['lateCancelRefundRate', 'noShowRefundRate']) {
    if (!Number.isFinite(Number(policy[key])) || Number(policy[key]) < 0 || Number(policy[key]) > 1) throw new Error(`${key} must be between 0 and 1.`)
  }
  for (const key of ['freeCancelHours', 'requestExpiryHours', 'disputeWindowHours']) {
    if (!Number.isFinite(Number(policy[key])) || Number(policy[key]) < 0) throw new Error(`${key} must be a non-negative number of hours.`)
  }
}

async function readSettings() {
  return { ...defaults(), ...(await apiState.get(SETTINGS_KEY) ?? {}) }
}

export const settingsService = {
  async getFees() {
    return (await readSettings()).fees
  },
  async getRefundPolicy() {
    return (await readSettings()).refundPolicy
  },
  async getSettings() {
    const settings = await readSettings()
    return { ...settings, ...settings.fees }
  },
  async update(changes = {}) {
    const current = await readSettings()
    const fees = { ...current.fees, ...(changes.fees ?? {}) }
    const refundPolicy = { ...current.refundPolicy, ...(changes.refundPolicy ?? {}) }
    validateFees(fees)
    validateRefundPolicy(refundPolicy)
    const settings = {
      fees: Object.fromEntries(Object.entries(fees).map(([key, value]) => [key, Number.isFinite(Number(value)) ? Number(value) : value])),
      refundPolicy: Object.fromEntries(Object.entries(refundPolicy).map(([key, value]) => [key, Number(value)])),
    }
    await apiState.put(SETTINGS_KEY, settings)
    return { ...settings, ...settings.fees }
  },
  async updateFees(changes) {
    return (await this.update({ fees: changes })).fees
  },
}
