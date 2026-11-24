import { useCallback, useMemo, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import BalanceCards from '../components/payment/BalanceCards'
import MoneyCell from '../components/payment/MoneyCell'
import ReservationPaymentAuditModal from '../components/payment/ReservationPaymentAuditModal'
import DisputeEvidencePicker from '../components/disputes/DisputeEvidencePicker'
import DisputeEvidenceGallery from '../components/disputes/DisputeEvidenceGallery'
import WithdrawModal from '../components/payment/WithdrawModal'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import PageHeading from '../components/ui/PageHeading'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { payoutService } from '../services/payoutService'
import { reservationService } from '../services/reservationService'
import { settingsService } from '../services/settingsService'
import { disputeService } from '../services/disputeService'

const EMPTY_ROWS = []
const earningStatusTone = { Available: 'success', Pending: 'pending', Refunded: 'danger', Disputed: 'info', Cancelled: 'neutral', 'No-show': 'danger' }
const payoutStatusTone = { Requested: 'pending', Processing: 'info', Paid: 'success', Failed: 'danger' }

function OwnerEarningsPage() {
  const loader = useCallback(async () => {
    await reservationService.completePastReservations()
    const reservations = await reservationService.getOwnerReservations()
    await payoutService.reconcileCompletedReservations(reservations)
    const [balance, earnings, payouts, accounts, settings, disputes] = await Promise.all([
      payoutService.getBalance(),
      payoutService.getEarnings(),
      payoutService.getPayouts(),
      payoutService.getPayoutAccounts(),
      settingsService.getSettings(),
      disputeService.getDisputes(),
    ])
    return { balance, earnings, payouts, accounts, settings, disputes }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [auditReservationId, setAuditReservationId] = useState(null)
  const [selectedDispute, setSelectedDispute] = useState(null)
  const [ownerResponse, setOwnerResponse] = useState('')
  const [disputeEvidence, setDisputeEvidence] = useState([])
  const [disputeBusy, setDisputeBusy] = useState(false)
  const [disputeError, setDisputeError] = useState('')

  const earnings = data?.earnings ?? EMPTY_ROWS
  const disputes = data?.disputes ?? EMPTY_ROWS
  const filteredEarnings = useMemo(
    () => earnings.filter((earning) => {
      if (statusFilter !== 'All' && earning.status !== statusFilter) return false
      const date = String(earning.date ?? '').slice(0, 10)
      if (fromDate && date < fromDate) return false
      if (toDate && date > toDate) return false
      return true
    }),
    [earnings, fromDate, statusFilter, toDate],
  )

  async function requestWithdrawal(payload) {
    setIsSubmitting(true)
    setActionError('')
    try {
      await payoutService.requestWithdrawal(payload)
      setNotice('Withdrawal requested. Your available balance has been updated.')
      setShowWithdraw(false)
      reload()
    } catch (withdrawError) {
      setActionError(withdrawError instanceof Error ? withdrawError.message : 'Withdrawal could not be requested.')
      throw withdrawError
    } finally {
      setIsSubmitting(false)
    }
  }

  async function addPayoutAccount(account) {
    const result = await payoutService.addPayoutAccount(account)
    reload()
    return result
  }

  async function openDispute(dispute) {
    setSelectedDispute(dispute)
    setOwnerResponse('')
    setDisputeEvidence([])
    setDisputeError('')
    try {
      setSelectedDispute(await disputeService.getDisputeDetails(dispute.id))
    } catch (detailError) {
      setDisputeError(detailError.message || 'Dispute details could not be loaded.')
    }
  }

  async function submitDisputeResponse(event) {
    event.preventDefault()
    if (!selectedDispute || selectedDispute.ownerResponse?.submittedAt) return
    if (!ownerResponse.trim()) {
      setDisputeError('Describe your side before submitting your response.')
      return
    }
    if (disputeEvidence.some((item) => !item.description.trim())) {
      setDisputeError('Add a short description to each proof photo, or remove that photo.')
      return
    }
    setDisputeBusy(true)
    setDisputeError('')
    try {
      for (const item of disputeEvidence) {
        if (item.uploaded) continue
        await disputeService.addEvidence(selectedDispute.id, 'owner', item)
        setDisputeEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, uploaded: true } : entry))
      }
      await disputeService.submitOwnerResponse(selectedDispute.id, ownerResponse)
      setNotice('Your response and proof were submitted. The customer and administrator were notified.')
      setSelectedDispute(null)
      reload()
    } catch (responseError) {
      setDisputeError(responseError.message || 'Your response could not be submitted. Retry without removing uploaded proof.')
    } finally {
      setDisputeBusy(false)
    }
  }

  const earningColumns = [
    { key: 'date', label: 'Booking date' },
    { key: 'user', label: 'User' },
    { key: 'facility', label: 'Facility' },
    { key: 'courtRate', label: 'Gross', className: 'text-right', render: (row) => <MoneyCell amount={row.courtRate} /> },
    { key: 'ownerCommission', label: 'Commission', className: 'text-right', render: (row) => <MoneyCell amount={row.ownerCommission} /> },
    { key: 'ownerNet', label: 'Net', className: 'text-right font-semibold', render: (row) => <MoneyCell amount={row.ownerNet} /> },
    {
      key: 'refundedAmount',
      label: 'Refunded',
      className: 'text-right',
      render: (row) => Number(row.refundedAmount) > 0 ? (
        <div>
          <MoneyCell amount={row.refundedAmount} />
          {row.refundStatus === 'pending' ? <span className="block text-[10px] text-muted">Pending processing</span> : null}
        </div>
      ) : '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge tone={earningStatusTone[row.status] ?? 'neutral'}>{row.status}</Badge>,
    },
    {
      key: 'receipt',
      label: 'Receipt / audit',
      render: (row) => Number.isSafeInteger(Number(row.reservationId)) && Number(row.reservationId) > 0
        ? <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => setAuditReservationId(Number(row.reservationId))}>View</Button>
        : <span className="text-xs text-muted">—</span>,
    },
  ]

  const payoutColumns = [
    {
      key: 'requestedAt',
      label: 'Date',
      render: (row) => new Date(row.requestedAt).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    },
    { key: 'amount', label: 'Amount', className: 'text-right', render: (row) => <MoneyCell amount={row.amount} /> },
    { key: 'fee', label: 'Fee', className: 'text-right', render: (row) => <MoneyCell amount={row.fee} /> },
    { key: 'net', label: 'Net received', className: 'text-right font-semibold', render: (row) => <MoneyCell amount={row.net} /> },
    { key: 'destination', label: 'Destination' },
    { key: 'reference', label: 'Transfer reference', render: (row) => row.reference || '—' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div>
          <Badge tone={payoutStatusTone[row.status] ?? 'neutral'}>{row.status}</Badge>
          {row.status === 'Failed' && row.reason ? <p className="mt-1 text-xs text-muted">{row.reason}</p> : null}
        </div>
      ),
    },
  ]

  const disputeColumns = [
    { key: 'user', label: 'Customer' },
    { key: 'facility', label: 'Facility' },
    { key: 'reason', label: 'Reason' },
    { key: 'createdAt', label: 'Reported', render: (row) => formatDisputeDateTime(row.createdAt) },
    { key: 'responseStatus', label: 'Status', render: (row) => <Badge tone={row.ownerResponse?.submittedAt ? 'info' : 'pending'}>{row.ownerResponse?.submittedAt ? 'Sent to admin' : 'Awaiting your response'}</Badge> },
    { key: 'actions', label: 'Details', render: (row) => <Button variant="info" className="px-2 py-1.5 text-xs" onClick={() => openDispute(row)}>Review</Button> },
  ]

  function exportReport() {
    if (!earnings.length) return
    const headers = ['Date', 'User', 'Facility', 'Gross', 'Commission', 'Net', 'Status']
    const rows = earnings.map((item) => [
      item.date,
      item.user,
      item.facility,
      item.courtRate,
      item.ownerCommission,
      item.ownerNet,
      item.status,
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'reserva-earnings-report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeading
        title="Earnings & Payments"
        description="Track completed booking earnings, available funds, and payout history."
        action={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!earnings.length} onClick={exportReport}>Export report</Button>
            <Button disabled={!data || data.balance.available <= 0} onClick={() => {
              setNotice('')
              setActionError('')
              reload()
              setShowWithdraw(true)
            }}>
              Withdraw
            </Button>
          </div>
        )}
      />
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      {actionError && !showWithdraw ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {data ? (
        <>
          {data.balance.available < 0 ? (
            <p role="status" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              Your balance is negative and will be deducted from future earnings.
            </p>
          ) : null}
          <BalanceCards balance={data.balance} />
          <section aria-label="Dispute queue" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Dispute queue</h2>
              <p className="mt-1 text-xs text-muted">Review customer reports and submit your response before the administrator can decide the case.</p>
            </div>
            <Table columns={disputeColumns} rows={disputes.filter((dispute) => dispute.status === 'Open')} rowKey="id" emptyMessage="There are no open disputes for your facilities." caption="Facility booking disputes" />
          </section>
          <section aria-label="Booking earnings" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Booking earnings</h2>
              <p className="mt-1 text-xs text-muted">Funds become available after a booking is completed and its date has passed. Open disputes remain on hold.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                options={['All', 'Pending', 'Available', 'Refunded', 'Disputed', 'Cancelled', 'No-show']}
              />
              <Input label="From date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              <Input label="To date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </div>
            <Table
              columns={earningColumns}
              rows={filteredEarnings}
              rowKey="id"
              emptyMessage="No booking earnings match these filters."
              caption="Booking earnings"
            />
          </section>
          <section aria-label="Payout history" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Payout history</h2>
              <p className="mt-1 text-xs text-muted">If a payout fails, the amount less its non-refundable withdrawal fee returns to your available balance.</p>
            </div>
            <Table
              columns={payoutColumns}
              rows={data.payouts}
              rowKey="id"
              emptyMessage="No payouts have been requested yet."
              caption="Payout history"
            />
          </section>
          <Modal open={Boolean(selectedDispute)} onClose={() => { if (!disputeBusy) setSelectedDispute(null) }} title="Review booking dispute" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            {selectedDispute ? <div className="space-y-4">
              <div className="space-y-1 rounded-md border border-border bg-bg p-3 text-sm">
                <p><span className="text-muted">Customer:</span> {selectedDispute.user}</p>
                <p><span className="text-muted">Facility:</span> {selectedDispute.facility}</p>
                <p><span className="text-muted">Reservation date:</span> {selectedDispute.reservationSnapshot?.date ?? '—'}</p>
                <p><span className="text-muted">Reason:</span> {selectedDispute.reason}</p>
                <p className="whitespace-pre-wrap pt-2">{selectedDispute.details}</p>
                <DisputeEvidenceGallery title="Customer proof" items={selectedDispute.userEvidence ?? []} />
              </div>
              {selectedDispute.ownerResponse?.submittedAt ? <div className="rounded-md border border-border p-3"><h3 className="text-sm font-bold">Your submitted response</h3><p className="mt-2 whitespace-pre-wrap text-sm">{selectedDispute.ownerResponse.details}</p><DisputeEvidenceGallery title="Your proof" items={selectedDispute.ownerEvidence ?? []} /><p className="mt-3 text-xs text-muted">Your response was sent to the customer and administrator. The administrator can now review and resolve the dispute.</p></div> : (
                <form className="space-y-3" onSubmit={submitDisputeResponse}>
                  <label className="block text-xs font-medium text-muted" htmlFor="owner-dispute-response">Your response
                    <textarea id="owner-dispute-response" value={ownerResponse} onChange={(event) => setOwnerResponse(event.target.value)} maxLength={2000} rows={4} required className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" placeholder="Explain your side of the booking issue." />
                  </label>
                  <DisputeEvidencePicker items={disputeEvidence} onChange={setDisputeEvidence} disabled={disputeBusy} />
                  {disputeError ? <p role="alert" className="text-sm text-danger">{disputeError}</p> : null}
                  <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={disputeBusy} onClick={() => setSelectedDispute(null)}>Cancel</Button><Button type="submit" disabled={disputeBusy || !ownerResponse.trim() || disputeEvidence.some((item) => !item.description.trim())}>{disputeBusy ? 'Submitting…' : 'Submit response'}</Button></div>
                </form>
              )}
              {disputeError && selectedDispute.ownerResponse?.submittedAt ? <p role="alert" className="text-sm text-danger">{disputeError}</p> : null}
            </div> : null}
          </Modal>
          <WithdrawModal
            open={showWithdraw}
            onClose={() => setShowWithdraw(false)}
            balance={data.balance}
            fees={data.settings.fees}
            payoutSchedule={data.settings.fees.payoutSchedule}
            accounts={data.accounts}
            onAddAccount={addPayoutAccount}
            onWithdraw={requestWithdrawal}
            submitting={isSubmitting}
          />
          <ReservationPaymentAuditModal
            open={Boolean(auditReservationId)}
            reservationId={auditReservationId}
            onClose={() => setAuditReservationId(null)}
          />
        </>
      ) : null}
    </div>
  )
}

export default OwnerEarningsPage

function formatDisputeDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
