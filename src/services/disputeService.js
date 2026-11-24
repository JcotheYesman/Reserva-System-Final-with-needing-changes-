import { api, apiState } from './api'
import { payoutService } from './payoutService'
import { reservationService } from './reservationService'
import { settingsService } from './settingsService'
import { userService } from './userService'

const DISPUTES_KEY = 'disputes'
const delay = (value) => value

async function readDisputes() {
  return (await apiState.get(DISPUTES_KEY)) ?? []
}

async function saveDisputes(disputes) {
  await apiState.put(DISPUTES_KEY, disputes)
}

export const disputeService = {
  async createDispute({ reservationId, reason, details }) {
    if (!reason?.trim() || !details?.trim()) {
      throw new Error('Choose a reason and describe the problem.')
    }
    const reservations = await reservationService.getReservedSchedule()
    const reservation = reservations.find((item) => item.id === reservationId)
    if (!reservation) throw new Error('Reservation not found.')
    if (reservation.status !== 'Completed') {
      throw new Error('Only completed reservations can be disputed.')
    }
    const settings = await settingsService.getSettings()
    if (!isDisputeEligible(reservation, settings.refundPolicy.disputeWindowHours)) {
      throw new Error('The dispute window for this reservation has ended.')
    }
    const profile = await userService.getProfile()
    const disputes = await readDisputes()
    if (disputes.some((dispute) => Number(dispute.reservationId) === Number(reservationId))) {
      throw new Error('A problem report has already been submitted for this reservation.')
    }
    const dispute = {
      id: `DSP-${crypto.randomUUID()}`,
      reservationId,
      userId: profile.id,
      user: profile.name,
      ownerId: reservation.ownerId ?? null,
      facility: reservation.name,
      reservationSnapshot: {
        id: reservation.id,
        name: reservation.name,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        courtRate: reservation.courtRate,
        serviceFee: reservation.serviceFee,
        ownerCommission: reservation.ownerCommission,
        ownerNet: reservation.ownerNet,
        userTotal: reservation.userTotal,
        paymentMethod: reservation.paymentMethod,
        paymentStatus: reservation.paymentStatus,
        payoutStatus: reservation.payoutStatus,
        status: reservation.status,
        refundedAmount: reservation.refundedAmount ?? 0,
      },
      reason: reason.trim(),
      details: details.trim(),
      status: 'Open',
      ownerResponse: null,
      ownerResponseStatus: 'Awaiting owner response',
      createdAt: new Date().toISOString(),
    }
    await saveDisputes([dispute, ...disputes])
    await payoutService.holdEarningForDispute(reservationId, true)
    await api('dispute.created', { method: 'POST', body: { id: dispute.id, reservationId: dispute.reservationId } })
    return delay({ ...dispute })
  },

  async getDisputes(status = '') {
    const disputes = (await api('dispute.list')).data ?? []
    return delay(disputes.filter((dispute) => !status || dispute.status === status))
  },

  async getDisputeDetails(id) {
    return (await api('dispute.details', { params: { id } })).data
  },

  async addEvidence(id, side, evidence) {
    return (await api('dispute.evidence.add', {
      method: 'POST',
      body: { id, side, evidenceId: evidence.id, description: evidence.description, image: evidence.data, name: evidence.name },
    })).data
  },

  async submitOwnerResponse(id, details) {
    return (await api('owner.dispute.respond', { method: 'POST', body: { id, details } })).data
  },

  async resolveDispute(id, { action, amount, note } = {}) {
    if (!note?.trim()) throw new Error('Add a note before resolving this dispute.')
    if (!['full-refund', 'partial-refund', 'reject'].includes(action)) {
      throw new Error('Choose a valid dispute resolution.')
    }
    const resolved = (await api('admin.dispute.resolve', { method: 'POST', body: { id, resolution: action, amount, note } })).data
    return resolved
  },
}

export function isDisputeEligible(reservation, disputeWindowHours, now = new Date()) {
  const eligibleUntil = getDisputeDeadline(reservation, disputeWindowHours)
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return Number.isFinite(timestamp) && eligibleUntil >= timestamp
}

function getDisputeDeadline(reservation, disputeWindowHours) {
  const completedAt = reservation.completedAt
  if (completedAt) {
    const timestamp = new Date(completedAt).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp + Number(disputeWindowHours) * 60 * 60 * 1000
  }
  const endTime = reservation.endTime
  const dateText = String(reservation.date ?? '')
  const dateParts = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeParts = String(endTime ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!dateParts || !timeParts) return 0
  return new Date(
    Number(dateParts[1]),
    Number(dateParts[2]) - 1,
    Number(dateParts[3]),
    Number(timeParts[1]),
    Number(timeParts[2]),
  ).getTime() + Number(disputeWindowHours) * 60 * 60 * 1000
}
