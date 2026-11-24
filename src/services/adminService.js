import { api, apiState } from './api'
import { auditLogService } from './auditLogService'
import { ownerService } from './ownerService'
import { payoutService } from './payoutService'

const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const flatten = (values) => values.flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value])

async function applications() {
  const values = await apiState.list('owner.application')
  if (!Array.isArray(values)) return []
  return values.filter((value) => value && typeof value === 'object').map((value, index) => {
    const owner = value.owner && typeof value.owner === 'object' ? value.owner : {}
    const business = value.business && typeof value.business === 'object' ? value.business : {}
    const facilityValues = Array.isArray(value.facilities) && value.facilities.length
      ? value.facilities
      : [value.facility && typeof value.facility === 'object' ? value.facility : {}]
    const normalizedOwner = {
      fullName: owner.fullName ?? value.fullName ?? 'Applicant details unavailable',
      email: owner.email ?? value.email ?? '',
      phone: owner.phone ?? value.phone ?? '',
    }
    const normalizedBusiness = {
      name: business.name ?? value.businessName ?? 'Business details unavailable',
      address: business.address ?? '',
      contact: business.contact ?? '',
      ownership: business.ownership ?? '',
    }
    const normalizedFacilities = facilityValues.map((facility) => ({
      name: facility?.name ?? value.facilityName ?? 'Facility details unavailable',
      sport: facility?.sport ?? '',
      courtCount: facility?.courtCount ?? '',
      hourlyRate: facility?.hourlyRate ?? '',
      openingTime: facility?.openingTime ?? '',
      closingTime: facility?.closingTime ?? '',
      amenities: Array.isArray(facility?.amenities) ? facility.amenities : [],
      equipmentCategories: Array.isArray(facility?.equipmentCategories) ? facility.equipmentCategories : [],
      image: typeof facility?.image === 'string' ? facility.image : null,
    }))
    const normalizedFacility = normalizedFacilities[0]
    const complete = Boolean(
      value.detailsComplete === true &&
      normalizedOwner.fullName && normalizedOwner.email && normalizedOwner.phone &&
      normalizedBusiness.name && normalizedBusiness.address && normalizedBusiness.contact && normalizedBusiness.ownership &&
      normalizedFacilities.length > 0 && normalizedFacilities.every((facility) =>
        facility.name && facility.sport && Number(facility.courtCount) > 0 && Number(facility.hourlyRate) > 0 &&
        facility.openingTime && facility.closingTime,
      ),
    )
    return {
      ...value,
      id: value.id ?? `legacy-application-${index + 1}`,
      owner: normalizedOwner,
      business: normalizedBusiness,
      facility: normalizedFacility,
      facilities: normalizedFacilities,
      detailsComplete: complete,
    }
  })
}

export const adminService = {
  async getDashboard() {
    const [facilities, apps, users] = await Promise.all([this.getFacilities(), applications(), this.getUsers()])
    const pending = apps.filter((item) => item.status === 'Pending review').length
    return { stats: [
      { label: 'Registered users', value: users.length, detail: 'Player and owner accounts' },
      { label: 'Active facilities', value: facilities.filter((item) => item.active).length, detail: 'Currently listed for booking' },
      { label: 'Applications to review', value: pending, detail: 'Facility registrations pending' },
      { label: 'Total facilities', value: facilities.length, detail: 'Across all sports' },
    ], applications: apps.slice(0, 5) }
  },
  async getApplications() { return applications() },
  async reviewApplication(id, status, reviewNote = '') {
    if (!['Approved', 'Needs changes'].includes(status)) throw new Error('Choose a supported application decision.')
    if (status === 'Needs changes' && !reviewNote.trim()) throw new Error('Add a note explaining what needs to be changed.')
    const result = (await api('admin.application.review', { method: 'POST', body: { id, status, reviewNote } })).data
    return result
  },
  async getFacilities() {
    const [facilities, users] = await Promise.all([ownerService.getFacilities(), this.getUsers()])
    return facilities.map((facility) => ({ ...facility, owner: users.find((user) => Number(user.id) === Number(facility.ownerId)) ?? null }))
  },
  async updateFacility(id, changes) {
    const { ownerEmail, ...updates } = changes
    if (ownerEmail) {
      const owner = (await this.getUsers()).find((item) => item.email === ownerEmail && item.role === 'Facility owner' && item.status === 'Active')
      if (!owner) throw new Error('Select an active facility owner account.')
      updates.owner = { id: owner.id, name: owner.name, email: owner.email }
    }
    return ownerService.updateFacility(id, updates)
  },
  async createFacility(facility) {
    const owner = (await this.getUsers()).find((item) => item.email === facility.ownerEmail && item.role === 'Facility owner' && item.status === 'Active')
    if (!owner) throw new Error('Select an active facility owner account.')
    return ownerService.createFacility({ ...facility, owner: { id: owner.id, name: owner.name, email: owner.email } })
  },
  async removeFacility(id, reason) { return ownerService.removeFacility(id, reason) },
  async getUsers() { return (await api('admin.users.list')).data },
  async updateUserStatus(id, status) {
    if (!['Active', 'Suspended'].includes(status)) throw new Error('Choose a supported account status.')
    await api('admin.user.status', { method: 'POST', body: { id, status } })
    return (await this.getUsers()).find((user) => Number(user.id) === Number(id))
  },
  async getRevenueDashboard() {
    const [financials, payoutRequests, disputes, payoutAccounts] = await Promise.all([
      payoutService.getPlatformFinancialData(), payoutService.getAdminPayouts(), api('admin.disputes.list').then((result) => result.data ?? []),
      api('admin.payout.accounts.list').then((result) => result.data ?? []),
    ])
    const payoutAccountById = new Map(payoutAccounts.map((account) => [String(account.id), account]))
    const enrichedPayoutRequests = payoutRequests.map((request) => {
      const payoutAccount = payoutAccountById.get(String(request.accountId)) ?? null
      return { ...request, owner: request.owner || payoutAccount?.ownerName || `Owner #${request.ownerId ?? ''}`, payoutAccount }
    })
    const payoutAccountRequests = payoutAccounts.filter((account) =>
      !account.verified && account.verificationStatus === 'Pending review',
    )
    const serviceFees = financials.earnings.reduce((sum, row) => sum + Number(row.serviceFee ?? 0), 0)
    const commissions = financials.earnings.reduce((sum, row) => sum + Number(row.ownerCommission ?? 0), 0)
    const refunds = financials.refunds.filter((row) => row.status === 'completed').reduce((sum, row) => sum + Number(row.totalRefunded ?? 0), 0)
    const withdrawalFees = enrichedPayoutRequests.reduce((sum, row) => sum + Number(row.fee ?? 0), 0)
    const ledger = [
      ...financials.earnings.map((row) => ({ id: row.id, reservationId: row.reservationId, date: row.date, type: 'Booking', reference: row.reservationId, owner: row.ownerId, gross: Number(row.courtRate), fees: Number(row.serviceFee), commission: Number(row.ownerCommission), amount: Number(row.serviceFee) + Number(row.ownerCommission), status: row.status })),
      ...financials.refunds.map((row) => ({ id: row.id, reservationId: row.reservationId, date: row.createdAt, type: 'Refund', reference: row.reservationId, owner: row.ownerId, gross: -Number(row.totalRefunded), fees: -Number(row.serviceFeeRefund ?? 0), commission: 0, amount: -Number(row.totalRefunded), status: row.status ?? 'Pending' })),
    ]
    return {
      stats: { serviceFees, commissions, withdrawalFees, totalNetRevenue: round(serviceFees + commissions + withdrawalFees - refunds), pendingPayouts: enrichedPayoutRequests.filter((item) => ['Requested', 'Processing'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0), totalRefunded: refunds },
      ledger,
      payoutRequests: enrichedPayoutRequests.filter((item) => ['Requested', 'Processing'].includes(item.status)),
      payoutAccountRequests,
      disputes: flatten(disputes).filter((item) => item.status === 'Open'),
    }
  },
  async updatePayoutRequest(id, action, note, reference = '') {
    if (!note?.trim()) throw new Error('Add an audit note before updating a payout request.')
    const statuses = { approve: 'Processing', reject: 'Failed', paid: 'Paid', fail: 'Failed' }
    if (!Object.hasOwn(statuses, action)) throw new Error('Choose a valid payout action.')
    const payout = (await api('admin.payout.update', {
      method: 'POST',
      body: { id, status: statuses[action], reason: ['reject', 'fail'].includes(action) ? note : '', note: note.trim(), reference: action === 'paid' ? reference.trim() : '' },
    })).data
    return payout
  },
  async updatePayoutAccount(id, decision, note) {
    if (!note?.trim()) throw new Error('Add an admin review note before updating a payout account.')
    if (!['approve', 'reject'].includes(decision)) throw new Error('Choose approve or reject.')
    const account = (await api('admin.payout.account.update', {
      method: 'POST',
      body: { id, status: decision === 'approve' ? 'Verified' : 'Rejected', note: note.trim() },
    })).data
    return account
  },
  async getReports() {
    const [facilities, apps, users] = await Promise.all([this.getFacilities(), applications(), this.getUsers()])
    return {
      totals: [
        { label: 'Users', value: users.length }, { label: 'Facilities', value: facilities.length },
        { label: 'Pending applications', value: apps.filter((item) => item.status === 'Pending review').length },
        { label: 'Approved applications', value: apps.filter((item) => item.status === 'Approved').length },
      ],
      facilitiesBySport: Object.entries(facilities.reduce((counts, facility) => ({ ...counts, [facility.sport]: (counts[facility.sport] ?? 0) + 1 }), {})).map(([sport, count]) => ({ sport, count })),
      applications: apps,
    }
  },
  async getPayments() {
    const [databasePayments, statePayments] = await Promise.all([api('admin.payments.list'), apiState.list('payments')])
    const statusLabels = { paid: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded', held: 'Held', released: 'Released', partially_refunded: 'Partially refunded' }
    const payments = (Array.isArray(databasePayments.data) ? databasePayments.data : []).map((payment) => {
      const amount = Number(payment.amount)
      const rawStatus = String(payment.status ?? '').toLowerCase()
      return {
        ...payment,
        customer: payment.customer ?? payment.user ?? 'Customer unavailable',
        facility: payment.facility ?? 'Facility unavailable',
        method: payment.method ?? 'Not recorded',
        amount: Number.isFinite(amount) ? amount : null,
        hasProof: Boolean(Number(payment.hasProof)),
        hasRefundProof: Boolean(Number(payment.hasRefundProof)),
        status: statusLabels[rawStatus] ?? payment.status ?? 'Unknown',
      }
    })
    const byReservation = new Map(payments.map((payment) => [String(payment.reservationId), payment]))
    const refunds = [...new Map(flatten(statePayments)
      .filter((record) => record?.type === 'refund' && record.id)
      .map((record) => [String(record.id), record])).values()]
      .map((refund) => {
        const original = refund.originalPaymentId
          ? payments.find((payment) => Number(payment.id) === Number(refund.originalPaymentId))
          : byReservation.get(String(refund.reservationId))
        const amount = Number(refund.totalRefunded)
        return {
          id: refund.id,
          reservationId: refund.reservationId,
          customer: original?.customer ?? 'Customer unavailable',
          facility: original?.facility ?? 'Facility unavailable',
          method: original?.method ?? 'Not recorded',
          amount: Number.isFinite(amount) ? amount : null,
          status: refund.status === 'completed' ? 'Refunded' : 'Refund pending',
          reference: refund.refundId ?? refund.id,
          date: refund.createdAt ?? '',
          type: 'refund',
          proofPaymentId: refund.originalPaymentId ?? original?.id ?? null,
          hasRefundProof: Boolean(original?.hasRefundProof),
        }
      })
    return [...payments, ...refunds]
  },
  async getPaymentProof(paymentId, kind = 'payment') {
    return (await api('payments.proof', { params: { paymentId, kind } })).data
  },
  async verifyPayment(paymentId) {
    return (await api('payments.verify', { method: 'POST', body: { paymentId } })).data
  },
  async rejectPayment(paymentId, reason) {
    return (await api('payments.reject', { method: 'POST', body: { paymentId, reason } })).data
  },
  async getAnnouncements() { return (await apiState.get('admin.announcements')) ?? [] },
  async createAnnouncement(announcement) {
    if (!announcement.title.trim() || !announcement.message.trim()) throw new Error('Enter an announcement title and message.')
    const created = { id: `ANN-${crypto.randomUUID()}`, title: announcement.title.trim(), message: announcement.message.trim(), audience: announcement.audience, publishedAt: new Date().toISOString() }
    await apiState.put('admin.announcements', [created, ...(await this.getAnnouncements())])
    return created
  },
}
