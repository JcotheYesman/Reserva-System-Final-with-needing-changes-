import { settingsService } from './settingsService'
import { calculateBookingFees, calculateRefund, formatPHP } from '../utils/fees'
import { formatTimeRange, intervalsOverlap, timeToMinutes } from '../utils/bookingTime'
import { api, apiState } from './api'
import { facilityService } from './facilityService'
import { paymentService } from './paymentService'
import { payoutService } from './payoutService'
import { userService } from './userService'

const wait = (value) => value

const RESERVATIONS_KEY = 'reservations'
const HISTORY_KEY = 'reservationHistory'
const DRAFT_KEY = 'bookingDraft'
let currentReservations = []
let currentHistory = []
let bookingDraft = {}
let bookedIntervals = []
let initialized = false
let initializationPromise = null
let sessionGeneration = 0

function resetSessionData() {
  sessionGeneration += 1
  initialized = false
  initializationPromise = null
  currentReservations = []
  currentHistory = []
  bookingDraft = {}
  bookedIntervals = []
}

if (typeof window !== 'undefined') {
  window.addEventListener('reserva:session-changed', resetSessionData)
}

async function initialize() {
  if (initialized) return
  if (initializationPromise) return initializationPromise

  const generation = sessionGeneration
  const loadingPromise = (async () => {
    const [savedReservations, savedHistory, savedDraft, databaseResult] = await Promise.all([
      apiState.get(RESERVATIONS_KEY),
      apiState.get(HISTORY_KEY),
      apiState.get(DRAFT_KEY),
      api('reservations.list').then((result) => result.data),
    ])
    if (generation !== sessionGeneration) {
      if (initializationPromise === loadingPromise) initializationPromise = null
      return initialize()
    }

    currentReservations = [...(databaseResult ?? []), ...(savedReservations ?? [])]
    currentHistory = savedHistory ?? []
    bookingDraft = savedDraft ?? {}
    initialized = true
  })()
  initializationPromise = loadingPromise
  try {
    await loadingPromise
  } finally {
    if (initializationPromise === loadingPromise) initializationPromise = null
  }
}
const persistReservations = () => apiState.put(RESERVATIONS_KEY, currentReservations.filter((item) => item.source !== 'database'))
const persistHistory = () => apiState.put(HISTORY_KEY, currentHistory)
const OPENING_HOUR = 8
const CLOSING_HOUR = 22
function totalCourtHours(reservation) {
  return Array.isArray(reservation.courtSchedules) && reservation.courtSchedules.length
    ? reservation.courtSchedules.reduce((total, court) => total + Number(court.duration ?? 0), 0)
    : Number.parseFloat(reservation.duration ?? 0) || 0
}

function cacheDatabaseReservation(value) {
  const reservationId = Number(value.id ?? value.reservation_id)
  if (!Number.isInteger(reservationId) || reservationId < 1) {
    throw new Error('The server did not return a valid reservation ID.')
  }
  const reservation = { ...value, id: reservationId, source: 'database' }
  const alreadyCached = currentReservations.some((item) => String(item.id) === String(reservationId))
  currentReservations = [reservation, ...currentReservations.filter((item) => String(item.id) !== String(reservationId))]
  const courtHours = totalCourtHours(reservation)
  const historyItem = {
    id: reservationId,
    facility: reservation.name,
    date: reservation.date,
    duration: `${courtHours} ${courtHours === 1 ? 'hr' : 'hrs'}`,
    status: reservation.status,
    courtRate: reservation.courtRate,
    serviceFee: reservation.serviceFee,
    ownerCommission: reservation.ownerCommission,
    ownerNet: reservation.ownerNet,
    userTotal: reservation.userTotal,
    total: reservation.total ?? reservation.userTotal,
    paymentMethod: reservation.paymentMethod,
    paymentStatus: reservation.paymentStatus,
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    courtSchedules: reservation.courtSchedules ?? [],
    courtCharges: reservation.courtCharges ?? reservation.courtRate,
    equipmentItems: reservation.equipmentItems ?? [],
    equipmentTotal: Number(reservation.equipmentTotal ?? 0),
    refundedAmount: reservation.refundedAmount ?? 0,
    refunds: reservation.refunds ?? [],
  }
  currentHistory = [historyItem, ...currentHistory.filter((item) => String(item.id) !== String(reservationId))]
  if (!alreadyCached) payoutService.recordBookingEarning(reservation).catch(() => {})
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('reserva:notifications-changed'))
  return reservation
}

export const reservationService = {
  async getDashboard() {
    await initialize()
    return wait({
      reservations: currentReservations,
      stats: [currentReservations.filter((item) => item.status === 'Confirmed').length, currentReservations.length, currentReservations.filter((item) => item.status === 'Pending').length],
    })
  },

  async getSchedule(facilityId, date, excludeReservationId) {
    await initialize()
    return wait(await facilityService.getAvailability(facilityId, date, excludeReservationId))
  },

  async getHistory() {
    await initialize()
    await this.completePastReservations()
    const knownReservationIds = new Set(currentReservations.map((reservation) => String(reservation.id)))
    const historyById = new Map(currentHistory
      .filter((item) => knownReservationIds.has(String(item.id)))
      .map((item) => [String(item.id), { ...item }]))
    for (const reservation of currentReservations) {
      const id = String(reservation.id)
      const item = historyById.get(id) ?? {}
      const courtHours = totalCourtHours(reservation)
      historyById.set(id, {
        ...item,
        id: reservation.id,
        facility: item.facility ?? reservation.name,
        date: reservation.date,
        duration: `${courtHours} ${courtHours === 1 ? 'hr' : 'hrs'}`,
        status: reservation.status,
        total: reservation.total ?? reservation.userTotal,
        userTotal: reservation.userTotal,
        paymentMethod: reservation.paymentMethod,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        courtSchedules: reservation.courtSchedules ?? [],
        courtCharges: reservation.courtCharges ?? reservation.courtRate,
        equipmentItems: reservation.equipmentItems ?? [],
        equipmentTotal: Number(reservation.equipmentTotal ?? 0),
      })
    }
    return wait([...historyById.values()].map((item) => {
      const reservation = currentReservations.find((candidate) => String(candidate.id) === String(item.id))
      const courtHours = reservation ? totalCourtHours(reservation) : 0
      return reservation
        ? {
          ...item,
          status: reservation.status,
          date: reservation.date,
          duration: `${courtHours} ${courtHours === 1 ? 'hr' : 'hrs'}`,
          userTotal: reservation.userTotal,
          refundedAmount: reservation.refundedAmount ?? 0,
          paymentMethod: reservation.paymentMethod,
          startTime: reservation.startTime,
          endTime: reservation.endTime,
          courtSchedules: reservation.courtSchedules ?? [],
          completedAt: reservation.completedAt,
        }
        : { ...item }
    }))
  },

  async getReservedSchedule() {
    await initialize()
    await this.completePastReservations()
    return wait([...currentReservations])
  },

  async getOwnerReservations(ownerId = null) {
    const resolvedOwnerId = ownerId ?? (await userService.getProfile()).id
    const { data = [] } = await api('reservations.list')
    return wait(data.filter((reservation) =>
      reservation.source === 'database' &&
      Number.isInteger(Number(reservation.id)) &&
      Number(reservation.ownerId) === Number(resolvedOwnerId),
    ))
  },

  async completePastReservations(now = new Date()) {
    await initialize()
    const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime()
    if (!Number.isFinite(timestamp)) throw new Error('Completion check time must be a valid date.')
    const completed = []
    currentReservations = currentReservations.map((reservation) => {
      if (reservation.status !== 'Confirmed') return reservation
      const endTimestamp = getReservationEndTimestamp(reservation)
      if (!endTimestamp || endTimestamp > timestamp) return reservation
      const updated = {
        ...reservation,
        status: 'Completed',
        completedAt: new Date(endTimestamp).toISOString(),
      }
      completed.push(updated)
      return updated
    })
    if (completed.length) {
      currentHistory = currentHistory.map((item) => {
        const reservation = completed.find((candidate) => candidate.id === item.id)
        return reservation
          ? { ...item, status: 'Completed', completedAt: reservation.completedAt }
          : item
      })
      bookedIntervals = bookedIntervals.map((booking) =>
        completed.some((reservation) => reservation.id === booking.id)
          ? { ...booking, status: 'Completed' }
          : booking,
      )
      for (const reservation of completed) {
        await payoutService.updateReservationEarning(reservation.id, 'Completed')
      }
      await Promise.all([persistReservations(), persistHistory()])
    }
    return wait(completed.map((reservation) => ({ ...reservation })))
  },

  async updateOwnerReservationStatus(reservationId, status, reason = '', refundProof = null) {
    await initialize()
    const result = await api('reservation.status', { method: 'POST', body: { id: reservationId, status, reason, refundProof } })
    await payoutService.updateReservationEarning(reservationId, status)
    return result.data
  },

  async getPaymentProof(paymentId) {
    return (await api('payments.proof', { params: { paymentId } })).data
  },

  async getPaymentAudit(reservationId) {
    return (await api('reservation.payment.audit', { params: { reservationId } })).data
  },

  async verifyPayment(paymentId) {
    return (await api('payments.verify', { method: 'POST', body: { paymentId } })).data
  },

  async recordCashPayment({ reservationId, amount, paymentProof, reference = '', requestId }) {
    return (await api('payments.record', { method: 'POST', body: { reservationId, amount, paymentProof, reference, requestId } })).data
  },

  async rescheduleReservation({ reservationId, date, time, endTime, courtBookings }) {
    const result = await api('reservation.reschedule', {
      method: 'POST',
      body: { reservationId, date, startTime: time, endTime, courtBookings },
    })
    currentReservations = (await api('reservations.list')).data ?? currentReservations
    await persistReservations()
    return result.data
  },

  async validateBookingAvailability(payload = {}) {
    await initialize()
    await assertBookingAvailable({ ...bookingDraft, ...payload })
    return wait({ available: true })
  },

  async createReservation(payload = {}) {
    await initialize()
    const nextDraft = { ...bookingDraft, ...payload }
    if (!['GCash', 'Maya', 'Card'].includes(nextDraft.paymentMethod)) {
      throw new Error('Choose GCash, Maya, or debit/credit card.')
    }
    if (!['full', 'half'].includes(nextDraft.paymentOption)) throw new Error('Choose full payment or a 50% downpayment.')
    if (nextDraft.paymentOption === 'half' && !['cash-checkin', 'online-checkin'].includes(nextDraft.balanceSettlement)) {
      throw new Error('Choose how the remaining balance will be settled.')
    }
    if (nextDraft.paymentMethod !== 'Card' && !nextDraft.paymentProof) throw new Error('Upload your payment receipt or proof to continue.')
    if (!nextDraft.requestId) {
      nextDraft.requestId = crypto.randomUUID()
      bookingDraft = nextDraft
      await apiState.put(DRAFT_KEY, bookingDraft)
    }
    const savedRequest = currentReservations.find((reservation) => reservation.requestId === nextDraft.requestId)
    if (savedRequest) return cacheDatabaseReservation(savedRequest)
    await assertBookingAvailable(nextDraft)
    const courtRate = Number(nextDraft.courtRate)
    const settings = await settingsService.getSettings()
    const feeSnapshot = calculateBookingFees(courtRate, settings.fees)
    const requestBody = {
      requestId: nextDraft.requestId,
      facilityId: Number(nextDraft.facilityId),
      date: nextDraft.date,
      startTime: nextDraft.time,
      endTime: nextDraft.endTime ?? formatTimeRange(nextDraft.time, nextDraft.duration).endTime,
      duration: Number(nextDraft.duration),
      quantity: Number(nextDraft.quantity ?? 1),
      courtIds: (nextDraft.courtIds ?? []).map(Number),
      courtBookings: Array.isArray(nextDraft.courtBookings) ? nextDraft.courtBookings.map((booking) => ({
        courtId: Number(booking.courtId),
        startTime: booking.startTime,
        endTime: booking.endTime,
        duration: Number(booking.duration),
      })) : undefined,
      equipmentItems: Array.isArray(nextDraft.equipmentItems) ? nextDraft.equipmentItems.map((item) => ({
        itemId: Number(item.itemId),
        quantity: Number(item.quantity),
      })) : [],
      paymentMethod: nextDraft.paymentMethod,
      paymentOption: nextDraft.paymentOption,
      balanceSettlement: nextDraft.paymentOption === 'half' ? nextDraft.balanceSettlement : '',
      savedPaymentMethodId: nextDraft.savedPaymentMethodId ? Number(nextDraft.savedPaymentMethodId) : null,
      paymentAccountName: nextDraft.paymentAccountName ?? '',
      paymentMobile: nextDraft.paymentMobile ?? '',
      totalAmount: Number(nextDraft.userTotal ?? feeSnapshot.userTotal),
      amountToPayNow: Number(nextDraft.amountToPayNow),
      promoCode: String(nextDraft.promoCode ?? '').trim().toUpperCase(),
      paymentProof: nextDraft.paymentMethod === 'Card' ? null : nextDraft.paymentProof,
      paymentReference: nextDraft.paymentReference ?? '',
    }
    bookingDraft = { ...nextDraft, ...requestBody }
    delete bookingDraft.paymentProof
    await apiState.put(DRAFT_KEY, bookingDraft)
    try {
      const result = await api('reservation.create', { method: 'POST', body: requestBody, timeoutMs: 30_000 })
      const validStatuses = ['Pending', 'Pending payment', 'Payment verification', 'Confirmed', 'Checked in', 'Completed', 'Cancelled', 'Disputed', 'Refunded']
      if (result.success === true && Number.isInteger(Number(result.reservation_id)) &&
        validStatuses.includes(result.status) && result.reservation &&
        Number(result.reservation.id) === Number(result.reservation_id) &&
        result.reservation.status === result.status) {
        return cacheDatabaseReservation({ ...result.reservation, requestId: nextDraft.requestId })
      }
      return await this.reconcileReservationRequest(nextDraft.requestId)
    } catch (error) {
      if (Number(error?.status) === 409) {
        const saved = await this.findReservationByRequestId(nextDraft.requestId).catch(() => null)
        if (saved) return cacheDatabaseReservation(saved)
        throw error
      }
      const isUncertain = ['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'INVALID_RESPONSE', 'SERVER_UNAVAILABLE'].includes(error?.code) ||
        (Number(error?.status) >= 500)
      if (!isUncertain) throw error
      try {
        const saved = await this.findReservationByRequestId(nextDraft.requestId)
        if (saved) return cacheDatabaseReservation(saved)
      } catch {
        // Keep the user in an explicit uncertain state when the status lookup also fails.
      }
      const uncertainError = new Error('The reservation response was interrupted, so its status is not confirmed. Check Reservation History before retrying. A retry will use the same request ID to avoid duplicates.')
      uncertainError.code = 'RESERVATION_STATUS_UNKNOWN'
      uncertainError.requestId = nextDraft.requestId
      throw uncertainError
    }
  },

  async findReservationByRequestId(requestId) {
    const result = await api('reservations.list', { timeoutMs: 10_000 })
    return (result.data ?? []).find((reservation) => reservation.requestId === requestId) ?? null
  },

  async reconcileReservationRequest(requestId) {
    const saved = await this.findReservationByRequestId(requestId).catch(() => null)
    if (saved) return cacheDatabaseReservation(saved)
    const uncertainError = new Error('The server response did not confirm the reservation. Check Reservation History before retrying; the request has not been reported as successful.')
    uncertainError.code = 'RESERVATION_STATUS_UNKNOWN'
    uncertainError.requestId = requestId
    throw uncertainError
  },

  async cancelReservation(reservationId, cancelledBy = 'user', reason = '') {
    await initialize()
    const index = currentReservations.findIndex((reservation) => reservation.id === reservationId)
    if (index < 0) throw new Error('Reservation not found.')
    const reservation = currentReservations[index]
    if (reservation.source === 'database' && cancelledBy === 'user') {
      const response = await api('reservation.cancel', { method: 'POST', body: { id: reservationId } })
      const result = response.data
      currentReservations[index] = { ...reservation, status: 'Cancelled', refundedAmount: Number(result.refund?.totalRefunded ?? 0), paymentStatus: Number(result.refund?.totalRefunded ?? 0) > 0 ? 'refund_pending' : reservation.paymentStatus }
      await persistReservations()
      return {
        reservation: currentReservations[index],
        refund: { ...(result.refund ?? {}), refundId: result.refundId, total: Number(result.refund?.totalRefunded ?? 0) },
      }
    }
    if (reservation.status === 'Cancelled') throw new Error('This reservation is already cancelled.')
    if (!['user', 'owner', 'system', 'admin', 'no-show'].includes(cancelledBy)) {
      throw new Error('Choose a supported cancellation reason.')
    }
    if (['owner', 'admin'].includes(cancelledBy) && !reason.trim()) {
      throw new Error('A cancellation reason is required.')
    }
    if (cancelledBy === 'user' && !isBeforeReservationStart(reservation)) {
      throw new Error('A reservation cannot be cancelled after its start time.')
    }
    if (reservation.refundedAmount > 0) throw new Error('This reservation already has a refund.')
    const refund = calculateRefund(reservation, cancelledBy)
    const refundRecord = refund.totalRefunded > 0
      ? await paymentService.refundPayment(reservation.id, refund.totalRefunded, {
        ...refund,
        cancelledBy,
        reason: reason.trim() || refund.reason,
      })
      : null
    const nextRefunds = refundRecord ? [...(reservation.refunds ?? []), refundRecord] : reservation.refunds ?? []
    const updated = {
      ...reservation,
      status: cancelledBy === 'no-show' ? 'No-show' : 'Cancelled',
      cancellationReason: reason.trim() || refund.reason,
      refunds: nextRefunds,
      refundedAmount: refund.totalRefunded,
      paymentStatus: refund.totalRefunded >= reservation.userTotal
        ? 'refund_pending'
        : refund.totalRefunded > 0
          ? 'refund_pending'
          : reservation.paymentStatus,
      payoutStatus: refund.retainedByOwner > 0 ? reservation.payoutStatus : 'refunded',
    }
    currentReservations[index] = updated
    bookedIntervals = bookedIntervals.map((booking) =>
      booking.id === reservation.id ? { ...booking, status: updated.status } : booking,
    )
    currentHistory = currentHistory.map((item) =>
      item.id === reservation.id
        ? {
          ...item,
          status: updated.status,
          paymentStatus: updated.paymentStatus,
          refundedAmount: updated.refundedAmount,
          refunds: updated.refunds,
        }
        : item,
    )
    await Promise.all([persistReservations(), persistHistory()])
    await payoutService.recordRefund(reservation.id, {
      ...refund,
      refundId: refundRecord?.refundId,
      reservationStatus: updated.status,
    }, reservation.ownerId)
    await userService.addNotification({
      title: cancelledBy === 'system' ? 'Reservation request expired' : 'Reservation cancelled',
      message: `Your booking at ${reservation.name} was cancelled. Refund: ${formatPHP(refund.totalRefunded)}.`,
      type: refund.totalRefunded > 0 ? 'success' : 'warning',
    })
    return wait({
      reservation: { ...updated },
      refund: { ...refund, refundId: refundRecord?.refundId, total: refund.totalRefunded },
    })
  },

  async getCancellationPreview(reservationId, cancelledBy = 'user') {
    await initialize()
    const collections = await apiState.list('reservations').catch(() => [])
    const reservation = currentReservations.find((item) => item.id === reservationId) ??
      collections.flatMap((items) => Array.isArray(items) ? items : []).find((item) => item.id === reservationId)
    if (!reservation) throw new Error('Reservation not found.')
    if (reservation.source === 'database') {
      return (await api('reservation.cancel.preview', { params: { id: reservationId } })).data
    }
    const refund = calculateRefund(reservation, cancelledBy)
    return wait({
      ...refund,
      total: refund.totalRefunded,
      courtRate: reservation.courtRate,
      serviceFee: reservation.serviceFee,
      userTotal: reservation.userTotal,
      courtRateRefund: refund.courtRefund,
      serviceFeeNonRefundable: roundMoney(reservation.serviceFee - refund.serviceFeeRefund),
    })
  },

  async refundReservation(reservationId, { amount, cancelledBy = 'admin', reason = '' } = {}) {
    await initialize()
    const index = currentReservations.findIndex((reservation) => reservation.id === reservationId)
    if (index < 0) throw new Error('Reservation not found.')
    const reservation = currentReservations[index]
    if (!reason.trim()) throw new Error('A refund reason is required.')
    if (reservation.refundedAmount > 0) throw new Error('This reservation already has a refund.')
    const refundAmount = roundMoney(Number(amount))
    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > reservation.userTotal) {
      throw new Error('Refund amount must be greater than zero and no more than the booking total.')
    }
    const courtRefund = roundMoney(Math.min(refundAmount, reservation.courtRate))
    const serviceFeeRefund = roundMoney(refundAmount - courtRefund)
    if (serviceFeeRefund > reservation.serviceFee) {
      throw new Error('Refund exceeds the reservation fee snapshot.')
    }
    const retainedCourtRate = roundMoney(reservation.courtRate - courtRefund)
    const commissionRetained = reservation.courtRate > 0
      ? roundMoney(reservation.ownerCommission * retainedCourtRate / reservation.courtRate)
      : 0
    const refund = {
      courtRefund,
      serviceFeeRefund,
      totalRefunded: refundAmount,
      retainedByOwner: roundMoney(Math.max(0, retainedCourtRate - commissionRetained)),
      retainedByPlatform: roundMoney(
        reservation.serviceFee - serviceFeeRefund +
        commissionRetained -
        Number(reservation.gatewayFee ?? 0),
      ),
      gatewayFeeLost: roundMoney(Number(reservation.gatewayFee ?? 0)),
      reason: reason.trim(),
    }
    const refundRecord = await paymentService.refundPayment(reservation.id, refundAmount, {
      ...refund,
      cancelledBy,
      reason,
    })
    const totalRefunded = roundMoney(Number(reservation.refundedAmount ?? 0) + refundAmount)
    const updated = {
      ...reservation,
      refunds: [...(reservation.refunds ?? []), refundRecord],
      refundedAmount: totalRefunded,
      paymentStatus: 'refund_pending',
      payoutStatus: refund.retainedByOwner > 0 ? reservation.payoutStatus : 'refunded',
    }
    currentReservations[index] = updated
    currentHistory = currentHistory.map((item) =>
      item.id === reservation.id
        ? {
          ...item,
          paymentStatus: updated.paymentStatus,
          refundedAmount: totalRefunded,
          refunds: updated.refunds,
        }
        : item,
    )
    await Promise.all([persistReservations(), persistHistory()])
    await payoutService.recordRefund(reservation.id, {
      ...refund,
      refundId: refundRecord.refundId,
      reservationStatus: reservation.status,
    }, reservation.ownerId)
    return wait({ ...refund, refundId: refundRecord.refundId })
  },

  async expireStaleRequests(now = new Date()) {
    await initialize()
    const settings = await settingsService.getSettings()
    const expiryMs = settings.refundPolicy.requestExpiryHours * 60 * 60 * 1000
    const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime()
    if (!Number.isFinite(timestamp)) throw new Error('Expiry check time must be a valid date.')
    const stale = currentReservations.filter((reservation) =>
      reservation.status === 'Pending' &&
      reservation.createdAt &&
      timestamp - new Date(reservation.createdAt).getTime() >= expiryMs,
    )
    const expired = []
    for (const reservation of stale) {
      const result = await this.cancelReservation(reservation.id, 'system', 'Owner response period expired.')
      expired.push(result.reservation)
    }
    return wait(expired)
  },

  async getBookingDraft() {
    await initialize()
    return wait({ ...bookingDraft })
  },

  async saveBookingDraft(payload) {
    await initialize()
    const nextDraft = { ...bookingDraft, ...payload, requestId: crypto.randomUUID() }
    await assertBookingAvailable(nextDraft)
    bookingDraft = nextDraft
    await apiState.put(DRAFT_KEY, bookingDraft)
    return wait({ ...bookingDraft })
  },

}

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

async function assertBookingAvailable(draft) {
  await initialize()
  if (Array.isArray(draft.courtBookings) && Array.isArray(draft.courtIds)) {
    const courtIds = draft.courtIds.map(Number)
    const quantity = Number(draft.quantity ?? 1)
    const bookings = draft.courtBookings
    if (!draft.facilityId || !/^\d{4}-\d{2}-\d{2}$/.test(String(draft.date ?? '')) ||
      !Number.isInteger(quantity) || quantity < 1 || courtIds.length !== quantity ||
      new Set(courtIds).size !== quantity || bookings.length !== quantity) {
      throw new Error('Choose one available schedule for every selected court.')
    }
    const scheduleCourtIds = bookings.map((booking) => Number(booking.courtId))
    if (new Set(scheduleCourtIds).size !== quantity || courtIds.some((id) => !scheduleCourtIds.includes(id))) {
      throw new Error('Each selected court must have its own schedule.')
    }
    const availability = await facilityService.getAvailability(draft.facilityId, draft.date, draft.rescheduleId)
    if (!availability.active) throw new Error('This facility is under maintenance and can only be viewed. Booking is unavailable.')
    for (const booking of bookings) {
      const startTime = String(booking.startTime ?? '')
      const endTime = String(booking.endTime ?? '')
      const duration = Number(booking.duration)
      const startMinutes = timeToMinutes(startTime)
      const endMinutes = timeToMinutes(endTime)
      if (!/^\d{2}:00$/.test(startTime) || !/^\d{2}:00$/.test(endTime) ||
        !Number.isInteger(duration) || duration < 1 || endMinutes - startMinutes !== duration * 60 ||
        startMinutes < OPENING_HOUR * 60 || endMinutes > CLOSING_HOUR * 60) {
        throw new Error('Each court must have a continuous hourly schedule within facility hours.')
      }
      const court = availability.courts.find((entry) => Number(entry.courtId) === Number(booking.courtId))
      const labels = Array.from({ length: duration }, (_, index) => `${String(Math.floor((startMinutes + index * 60) / 60)).padStart(2, '0')}:00`)
      if (!court || labels.some((label) => !court.slots.some((slot) => slot.label === label && slot.status === 'available'))) {
        const conflictError = new Error(`The selected time for Court ${booking.courtNumber ?? ''} is no longer available. Refresh and choose another time.`)
        conflictError.status = 409
        conflictError.code = 'BOOKING_CONFLICT'
        throw conflictError
      }
    }
    return
  }
  if (Array.isArray(draft.selectedSlots) && Array.isArray(draft.courtIds)) {
    const courtIds = draft.courtIds.map(Number)
    const quantity = Number(draft.quantity ?? 1)
    const duration = Number(draft.duration)
    const startMinutes = timeToMinutes(String(draft.time ?? ''))
    const endMinutes = timeToMinutes(String(draft.endTime ?? ''))
    if (!draft.facilityId || !draft.date || !Number.isInteger(quantity) || quantity < 1 || courtIds.length !== quantity || new Set(courtIds).size !== quantity) {
      throw new Error('Choose a facility, date, time range, and a different court for each selected court.')
    }
    if (!/^\d{2}:00$/.test(String(draft.time)) || !Number.isInteger(duration) || duration < 1 || endMinutes - startMinutes !== duration * 60 || draft.selectedSlots.length !== duration) {
      throw new Error('Select one or more adjacent hourly slots to create a continuous time range.')
    }
    if (startMinutes < OPENING_HOUR * 60 || endMinutes > CLOSING_HOUR * 60) {
      throw new Error('The selected time range must fall within facility hours.')
    }
    const availability = await facilityService.getAvailability(draft.facilityId, draft.date, draft.rescheduleId)
    if (!availability.active) throw new Error('This facility is under maintenance and can only be viewed. Booking is unavailable.')
    const selectedCourts = courtIds.map((id) => availability.courts.find((court) => Number(court.courtId) === id))
    if (selectedCourts.some((court) => !court)) throw new Error('One or more selected courts are no longer available.')
    const rangeAvailable = selectedCourts.every((court) => draft.selectedSlots.every((label) =>
      court.slots.some((slot) => slot.label === label && slot.status === 'available'),
    ))
    if (!rangeAvailable) {
      const conflictError = new Error('One of the selected courts or times was just taken. Refresh the schedule and choose another option.')
      conflictError.status = 409
      conflictError.code = 'BOOKING_CONFLICT'
      throw conflictError
    }
    return
  }
  const duration = Number(draft.duration)
  const quantity = Number(draft.quantity ?? 1)
  if (!draft.facilityId || !draft.date || !draft.time ||
    !Number.isInteger(duration) || duration < 1 ||
    !Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Choose a facility, date, start time, and duration.')
  }

  if (!/^\d{2}:00$/.test(draft.time)) {
    throw new Error('Choose a start time on the hour.')
  }
  const startMinutes = timeToMinutes(draft.time)
  const endMinutes = startMinutes + duration * 60
  if (startMinutes < OPENING_HOUR * 60) {
    throw new Error('Bookings must start at or after the facility opening time.')
  }
  if (endMinutes > CLOSING_HOUR * 60) {
    throw new Error('The selected duration extends beyond the facility closing time.')
  }
  const availability = await facilityService.getAvailability(draft.facilityId, draft.date)
  if (!canFitBooking(
    availability,
    draft.facilityId,
    draft.date,
    draft.time,
    duration * 60,
    quantity,
    [],
  )) {
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
    throw new Error(`Not enough courts are available from ${draft.time}–${endTime}. Change the time, duration, or number of courts.`)
  }
}

function isBeforeReservationStart(reservation) {
  const date = String(reservation.date ?? '')
  const time = String(reservation.startTime ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false
  return new Date(`${date}T${time}:00`).getTime() > Date.now()
}

function getReservationEndTimestamp(reservation) {
  const date = String(reservation.date ?? '')
  const time = String(reservation.endTime ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return 0
  const timestamp = new Date(`${date}T${time}:00`).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function canFitBooking(availability, facilityId, date, startTime, durationMinutes, quantity, ownerReservations = []) {
  const courtCount = Number(availability.courtCount)
  if (!Number.isInteger(Number(quantity)) || quantity < 1 || quantity > courtCount ||
    !Number.isInteger(durationMinutes) || durationMinutes < 60 ||
    !/^\d{2}:00$/.test(startTime)) return false
  const startMinutes = timeToMinutes(startTime)
  const endMinutes = startMinutes + durationMinutes
  if (startMinutes < OPENING_HOUR * 60 || endMinutes > CLOSING_HOUR * 60) return false
  const reservations = [
    ...bookedIntervals,
    ...currentReservations
      .filter((reservation) =>
        reservation.source !== 'database' &&
        !bookedIntervals.some((booking) => booking.id === reservation.id) &&
        Number(reservation.facilityId) === Number(facilityId) &&
        getISODate(reservation.date) === date &&
        ['Confirmed', 'Pending'].includes(reservation.status),
      )
      .map((reservation) => {
        const [startValue, endValue] = String(reservation.time ?? '').split(/\s*[-–]\s*/)
        return {
          facilityId: Number(reservation.facilityId),
          date,
          startTime: reservation.startTime ?? normalizeReservationTime(startValue),
          endTime: reservation.endTime ?? normalizeReservationTime(endValue),
          status: reservation.status,
          quantity: reservation.quantity ?? 1,
        }
      })
      .filter((reservation) => /^\d{2}:\d{2}$/.test(reservation.startTime) && /^\d{2}:\d{2}$/.test(reservation.endTime)),
    ...ownerReservations
      .filter((reservation) =>
        Number(reservation.facilityId) === Number(facilityId) &&
        getISODate(reservation.date) === date &&
        ['Confirmed', 'Pending'].includes(reservation.status),
      )
      .map((reservation) => {
        const [startTimeValue, endTimeValue] = String(reservation.time ?? '').split(/\s*[-–]\s*/)
        return {
          facilityId: Number(reservation.facilityId),
          date,
          startTime: reservation.startTime ?? normalizeReservationTime(startTimeValue),
          endTime: reservation.endTime ?? normalizeReservationTime(endTimeValue),
          status: reservation.status,
          quantity: reservation.quantity ?? 1,
        }
      })
      .filter((reservation) => /^\d{2}:\d{2}$/.test(reservation.startTime) && /^\d{2}:\d{2}$/.test(reservation.endTime)),
  ]

  const segments = []
  for (let segmentStart = startMinutes; segmentStart < endMinutes; segmentStart += 60) {
    const segmentEnd = Math.min(segmentStart + 60, endMinutes)
    const hourLabel = `${String(Math.floor(segmentStart / 60)).padStart(2, '0')}:00`
    segments.push({ segmentStart, segmentEnd, hourLabel })
    const availableCourtCount = availability.courts.filter((court) =>
      court.slots.some((slot) => slot.label === hourLabel && slot.status === 'available'),
    ).length
    const bookedCourtCount = reservations
      .filter((booking) =>
        booking.facilityId === Number(facilityId) &&
        booking.date === date &&
        ['Confirmed', 'Pending'].includes(booking.status) &&
        intervalsOverlap(
          `${String(Math.floor(segmentStart / 60)).padStart(2, '0')}:${String(segmentStart % 60).padStart(2, '0')}`,
          `${String(Math.floor(segmentEnd / 60)).padStart(2, '0')}:${String(segmentEnd % 60).padStart(2, '0')}`,
          booking.startTime,
          booking.endTime,
        ),
      )
      .reduce((total, booking) => total + Number(booking.quantity ?? 1), 0)
    if (availableCourtCount - bookedCourtCount < quantity) return false
  }

  // A reservation keeps the same court(s) for its full duration. Do not let
  // per-hour capacity on different courts combine into a false availability.
  const courtsAvailableForWholeRange = availability.courts.filter((court) =>
    segments.every(({ hourLabel }) =>
      court.slots.some((slot) => slot.label === hourLabel && slot.status === 'available'),
    ),
  ).length
  const maxExtraBookedCourtCount = Math.max(0, ...segments.map(({ segmentStart, segmentEnd }) =>
    reservations
      .filter((booking) =>
        booking.facilityId === Number(facilityId) &&
        booking.date === date &&
        ['Confirmed', 'Pending'].includes(booking.status) &&
        intervalsOverlap(
          `${String(Math.floor(segmentStart / 60)).padStart(2, '0')}:${String(segmentStart % 60).padStart(2, '0')}`,
          `${String(Math.floor(segmentEnd / 60)).padStart(2, '0')}:${String(segmentEnd % 60).padStart(2, '0')}`,
          booking.startTime,
          booking.endTime,
        ),
      )
      .reduce((total, booking) => total + Number(booking.quantity ?? 1), 0),
  ))

  return courtsAvailableForWholeRange - maxExtraBookedCourtCount >= quantity
}

function normalizeReservationTime(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!match) return ''
  let hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return ''
  if (match[3]) {
    if (hours < 1 || hours > 12) return ''
    hours = (hours % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0)
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getISODate(dateValue) {
  const value = String(dateValue ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = value.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/)
  if (!parts) return ''
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .findIndex((name) => name.toLowerCase() === parts[2].toLowerCase()) + 1
  if (month === 0) return ''
  return `${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}`
}
