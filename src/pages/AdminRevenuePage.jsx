import { useCallback, useMemo, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import FeeBreakdown from '../components/payment/FeeBreakdown'
import ReservationPaymentAuditModal from '../components/payment/ReservationPaymentAuditModal'
import DisputeEvidenceGallery from '../components/disputes/DisputeEvidenceGallery'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import StatCard from '../components/ui/StatCard'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { adminService } from '../services/adminService'
import { disputeService } from '../services/disputeService'
import { formatPHP } from '../utils/fees'

const EMPTY_ROWS = []
const payoutTone = { Requested: 'pending', Processing: 'info', Paid: 'success', Failed: 'danger' }
const disputeTone = { Open: 'pending', Resolved: 'success' }

function AdminRevenuePage() {
  const loader = useCallback(() => adminService.getRevenueDashboard(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [ledgerType, setLedgerType] = useState('All')
  const [ledgerStatus, setLedgerStatus] = useState('All')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedPayout, setSelectedPayout] = useState(null)
  const [payoutAction, setPayoutAction] = useState('')
  const [payoutNote, setPayoutNote] = useState('')
  const [payoutReference, setPayoutReference] = useState('')
  const [selectedPayoutAccount, setSelectedPayoutAccount] = useState(null)
  const [payoutAccountNote, setPayoutAccountNote] = useState('')
  const [selectedDispute, setSelectedDispute] = useState(null)
  const [isLoadingDispute, setIsLoadingDispute] = useState(false)
  const [disputeSide, setDisputeSide] = useState('user')
  const [disputeAction, setDisputeAction] = useState('')
  const [partialAmount, setPartialAmount] = useState('')
  const [disputeNote, setDisputeNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [auditReservationId, setAuditReservationId] = useState(null)
  const disputeReservation = selectedDispute?.reservationSnapshot ?? selectedDispute?.reservation ?? null

  const ledger = data?.ledger ?? EMPTY_ROWS
  const visibleLedger = useMemo(
    () => ledger.filter((entry) => {
      if (ledgerType !== 'All' && entry.type !== ledgerType) return false
      if (ledgerStatus !== 'All' && entry.status !== ledgerStatus) return false
      const date = String(entry.date ?? '').slice(0, 10)
      if (fromDate && date < fromDate) return false
      if (toDate && date > toDate) return false
      return true
    }),
    [fromDate, ledger, ledgerStatus, ledgerType, toDate],
  )

  async function submitPayoutAction(event) {
    event.preventDefault()
    if (!selectedPayout || !payoutAction) return
    setIsSubmitting(true)
    setActionError('')
    try {
      await adminService.updatePayoutRequest(selectedPayout.id, payoutAction, payoutNote, payoutReference)
      setSelectedPayout(null)
      setPayoutNote('')
      setPayoutReference('')
      setPayoutAction('')
      setNotice({
        approve: 'Payout approved and moved to processing.',
        reject: 'Payout request rejected. Its amount less the non-refundable fee has been returned to the owner balance.',
        paid: 'Payout marked paid. The owner was notified and the ledger was updated.',
        fail: 'Payout marked failed. Its amount less the non-refundable fee has been returned to the owner balance.',
      }[payoutAction])
      reload()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Payout request could not be updated.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function reviewPayoutAccount(decision) {
    if (!selectedPayoutAccount || !payoutAccountNote.trim()) return
    setIsSubmitting(true)
    setActionError('')
    try {
      await adminService.updatePayoutAccount(selectedPayoutAccount.id, decision, payoutAccountNote)
      setSelectedPayoutAccount(null)
      setPayoutAccountNote('')
      setNotice(decision === 'approve' ? 'Payout destination approved. The owner was notified.' : 'Payout destination rejected. The owner was notified.')
      reload()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Payout destination review could not be saved.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitDisputeAction(event) {
    event.preventDefault()
    if (!selectedDispute || !disputeAction) return
    const reservation = disputeReservation
    const amount = Number(partialAmount)
    const paidAmount = Number(reservation?.paidAmount ?? reservation?.userTotal ?? 0)
    if (disputeAction === 'partial-refund' &&
      (!Number.isFinite(amount) || amount <= 0 || amount > paidAmount)) {
      setActionError(`Enter a refund greater than zero and no more than ${formatPHP(paidAmount)}.`)
      return
    }
    setIsSubmitting(true)
    setActionError('')
    try {
      const resolved = await disputeService.resolveDispute(selectedDispute.id, {
        action: disputeAction,
        amount: disputeAction === 'partial-refund' ? amount : undefined,
        note: disputeNote,
      })
      setSelectedDispute(null)
      setDisputeAction('')
      setPartialAmount('')
      setDisputeNote('')
      setNotice(resolved.refund
        ? `Refund of ${formatPHP(resolved.refund.totalRefunded)} approved and added to the refund ledger. It is pending processing.`
        : 'Dispute resolution saved and added to the audit log.')
      reload()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Dispute could not be resolved.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function openPayoutAction(payout, action) {
    setSelectedPayout(payout)
    setPayoutAction(action)
    setPayoutNote('')
    setPayoutReference('')
    setActionError('')
  }

  async function openDispute(dispute) {
    setSelectedDispute(dispute)
    setDisputeSide('user')
    setDisputeAction('')
    setPartialAmount('')
    setDisputeNote('')
    setActionError('')
    setIsLoadingDispute(true)
    try {
      setSelectedDispute(await disputeService.getDisputeDetails(dispute.id))
    } catch (detailError) {
      setActionError(detailError.message || 'Dispute details could not be loaded.')
    } finally {
      setIsLoadingDispute(false)
    }
  }

  const ledgerColumns = [
    {
      key: 'date',
      label: 'Date',
      render: (entry) => {
        const date = new Date(entry.date)
        return Number.isNaN(date.getTime()) ? entry.date : date.toLocaleDateString('en-PH')
      },
    },
    { key: 'type', label: 'Type' },
    { key: 'reference', label: 'Reference' },
    { key: 'owner', label: 'Owner' },
    { key: 'gross', label: 'Gross', className: 'text-right', render: (entry) => formatPHP(entry.gross) },
    { key: 'fees', label: 'Fees', className: 'text-right', render: (entry) => formatPHP(entry.fees) },
    { key: 'commission', label: 'Commission', className: 'text-right', render: (entry) => formatPHP(entry.commission) },
    { key: 'amount', label: 'Platform amount', className: 'text-right font-semibold', render: (entry) => formatPHP(entry.amount) },
    { key: 'status', label: 'Status', render: (entry) => <Badge tone={entry.status === 'Refunded' || entry.type === 'Refund' ? 'danger' : 'neutral'}>{entry.status}</Badge> },
    {
      key: 'receipt',
      label: 'Receipt / audit',
      render: (entry) => Number.isSafeInteger(Number(entry.reservationId)) && Number(entry.reservationId) > 0
        ? <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => setAuditReservationId(Number(entry.reservationId))}>View</Button>
        : <span className="text-xs text-muted">—</span>,
    },
  ]

  const payoutColumns = [
    { key: 'owner', label: 'Owner' },
    { key: 'requestedAt', label: 'Requested', render: (row) => new Date(row.requestedAt).toLocaleString('en-PH') },
    { key: 'amount', label: 'Amount', className: 'text-right', render: (row) => formatPHP(row.amount) },
    { key: 'fee', label: 'Fee', className: 'text-right', render: (row) => formatPHP(row.fee) },
    { key: 'net', label: 'Net', className: 'text-right font-semibold', render: (row) => formatPHP(row.net) },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status', render: (row) => <Badge tone={payoutTone[row.status] ?? 'neutral'}>{row.status}</Badge> },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => row.status === 'Requested' ? (
        <div className="flex gap-1.5">
          <Button className="px-2 py-1.5 text-xs" onClick={() => openPayoutAction(row, 'approve')}>Approve</Button>
          <Button variant="danger" className="px-2 py-1.5 text-xs" onClick={() => openPayoutAction(row, 'reject')}>Reject</Button>
        </div>
      ) : row.status === 'Processing' ? (
        <div className="flex flex-wrap gap-1.5">
          <Button className="px-2 py-1.5 text-xs" onClick={() => openPayoutAction(row, 'paid')}>Mark Paid</Button>
          <Button variant="danger" className="px-2 py-1.5 text-xs" onClick={() => openPayoutAction(row, 'fail')}>Mark Failed</Button>
        </div>
      ) : <span className="text-xs text-muted">—</span>,
    },
  ]

  const payoutAccountColumns = [
    { key: 'ownerName', label: 'Owner' },
    { key: 'type', label: 'Type' },
    { key: 'name', label: 'Account holder' },
    { key: 'number', label: 'Account number', render: (row) => `•••• ${String(row.number ?? '').slice(-4)}` },
    { key: 'createdAt', label: 'Submitted', render: (row) => row.createdAt ? new Date(row.createdAt).toLocaleString('en-PH') : '—' },
    { key: 'actions', label: 'Action', render: (row) => <Button variant="info" className="px-2 py-1.5 text-xs" onClick={() => { setSelectedPayoutAccount(row); setPayoutAccountNote(''); setActionError('') }}>Review</Button> },
  ]

  const disputeColumns = [
    { key: 'user', label: 'User' },
    { key: 'owner', label: 'Owner' },
    { key: 'facility', label: 'Facility' },
    { key: 'reason', label: 'Reason' },
    { key: 'createdAt', label: 'Reported', render: (row) => formatDisputeDateTime(row.createdAt) },
    { key: 'status', label: 'Status', render: (row) => <div><Badge tone={disputeTone[row.status] ?? 'neutral'}>{row.status}</Badge><span className="mt-1 block text-[10px] text-muted">{row.ownerResponse?.submittedAt ? 'Owner responded' : 'Awaiting owner response'}</span></div> },
    {
      key: 'actions',
      label: 'Details',
      render: (row) => <Button variant="info" className="px-2 py-1.5 text-xs" onClick={() => openDispute(row)}>Review</Button>,
    },
  ]

  const stats = data ? [
    { label: 'Service fees', amount: data.stats.serviceFees },
    { label: 'Commissions', amount: data.stats.commissions },
    { label: 'Withdrawal fees', amount: data.stats.withdrawalFees },
    { label: 'Total net revenue', amount: data.stats.totalNetRevenue },
    { label: 'Pending payouts', amount: data.stats.pendingPayouts },
    { label: 'Total refunded', amount: data.stats.totalRefunded },
  ] : []

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeading title="Revenue & Payouts" description="Monitor platform revenue, payout requests, refund activity, and booking disputes." />
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      {actionError && !selectedPayout && !selectedDispute ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {data ? (
        <>
          <section aria-label="Platform revenue" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((item) => (
              <StatCard key={item.label} label={item.label} value={formatPHP(item.amount)} />
            ))}
          </section>
          <section aria-label="Payout requests" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Payout requests</h2>
              <p className="mt-1 text-xs text-muted">Approving moves a request to processing. Mark it paid only after the transfer completes; failed transfers return the amount less the non-refundable fee.</p>
            </div>
            <Table
              columns={payoutColumns}
              rows={data.payoutRequests}
              rowKey="id"
              emptyMessage="There are no payout requests awaiting review."
              caption="Owner payout requests"
            />
          </section>
          <section aria-label="Payout account verification" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Payout account verification</h2>
              <p className="mt-1 text-xs text-muted">Review the owner’s submitted destination and confirm it with them independently before approving it for withdrawals.</p>
            </div>
            <Table
              columns={payoutAccountColumns}
              rows={data.payoutAccountRequests}
              rowKey="id"
              emptyMessage="There are no payout destinations awaiting review."
              caption="Owner payout destinations awaiting verification"
            />
          </section>
          <section aria-label="Disputes queue" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Disputes queue</h2>
              <p className="mt-1 text-xs text-muted">Review the booking and its fee snapshot before recording an audited resolution.</p>
            </div>
            <Table
              columns={disputeColumns}
              rows={data.disputes}
              rowKey="id"
              emptyMessage="There are no open disputes."
              caption="Open booking disputes"
            />
          </section>
          <section aria-label="Transaction ledger" className="space-y-3">
            <div>
              <h2 className="text-sm font-bold">Transaction ledger</h2>
              <p className="mt-1 text-xs text-muted">Ledger values include booking fees, commissions, refunds, and payout fees.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Select
                label="Transaction type"
                value={ledgerType}
                onChange={(event) => setLedgerType(event.target.value)}
                options={['All', 'Booking', 'Refund', 'Withdrawal fee']}
              />
              <Select
                label="Status"
                value={ledgerStatus}
                onChange={(event) => setLedgerStatus(event.target.value)}
                options={['All', ...new Set(ledger.map((entry) => entry.status))]}
              />
              <Input label="From date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              <Input label="To date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </div>
            <Table
              columns={ledgerColumns}
              rows={visibleLedger}
              rowKey="id"
              emptyMessage="No ledger transactions match these filters."
              caption="Platform transaction ledger"
            />
          </section>
        </>
      ) : null}

      <Modal
        open={Boolean(selectedPayout)}
        onClose={() => {
          if (!isSubmitting) {
            setSelectedPayout(null)
            setActionError('')
          }
        }}
        title={{ approve: 'Approve payout', reject: 'Reject payout', paid: 'Mark payout as paid', fail: 'Mark payout failed' }[payoutAction] ?? 'Update payout'}
      >
        {selectedPayout ? (
          <form className="space-y-4" onSubmit={submitPayoutAction}>
            <p className="text-sm text-muted">
              {payoutAction === 'approve'
                ? `Approve ${formatPHP(selectedPayout.amount)} to ${selectedPayout.destination} and move it to processing?`
                : payoutAction === 'reject'
                  ? `Reject ${formatPHP(selectedPayout.amount)} to ${selectedPayout.destination}? The amount, less the non-refundable fee, will return to the owner balance.`
                  : payoutAction === 'paid'
                    ? `Confirm that ${formatPHP(selectedPayout.net)} was transferred to ${selectedPayout.destination}. Only mark it paid after the transfer is complete.`
                    : `Mark the transfer of ${formatPHP(selectedPayout.amount)} to ${selectedPayout.destination} as failed? The amount, less the non-refundable fee, will return to the owner balance.`}
            </p>
            {selectedPayout.payoutAccount ? (
              <div className="space-y-1 rounded-md border border-border bg-bg p-3 text-sm">
                <p className="font-semibold">Verified payout destination</p>
                <p><span className="text-muted">Account type:</span> {selectedPayout.payoutAccount.type}</p>
                <p><span className="text-muted">Account holder:</span> {selectedPayout.payoutAccount.name}</p>
                <p><span className="text-muted">Account number:</span> {selectedPayout.payoutAccount.number}</p>
              </div>
            ) : payoutAction === 'paid' ? <p role="alert" className="text-sm text-danger">The saved payout destination could not be loaded. Do not mark this payout paid until the destination is confirmed.</p> : null}
            {payoutAction === 'paid' ? <Input label="Transfer reference (optional)" value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} maxLength={150} /> : null}
            <div>
              <label htmlFor="payout-audit-note" className="mb-1.5 block text-xs font-medium text-muted">Admin note</label>
              <textarea
                id="payout-audit-note"
                value={payoutNote}
                onChange={(event) => setPayoutNote(event.target.value)}
                rows={3}
                maxLength={500}
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={isSubmitting} onClick={() => setSelectedPayout(null)}>Cancel</Button>
              <Button type="submit" variant={['reject', 'fail'].includes(payoutAction) ? 'danger' : 'primary'} disabled={isSubmitting || !payoutNote.trim() || payoutAction === 'paid' && !selectedPayout.payoutAccount}>
                {isSubmitting ? 'Saving…' : { approve: 'Approve payout', reject: 'Reject payout', paid: 'Confirm paid', fail: 'Confirm failed' }[payoutAction]}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedPayoutAccount)}
        onClose={() => { if (!isSubmitting) { setSelectedPayoutAccount(null); setActionError('') } }}
        title="Review payout destination"
      >
        {selectedPayoutAccount ? (
          <div className="space-y-4">
            <div className="space-y-1 rounded-md border border-border bg-bg p-3 text-sm">
              <p><span className="text-muted">Owner:</span> {selectedPayoutAccount.ownerName} · {selectedPayoutAccount.ownerEmail}</p>
              <p><span className="text-muted">Type:</span> {selectedPayoutAccount.type}</p>
              <p><span className="text-muted">Account holder:</span> {selectedPayoutAccount.name}</p>
              <p><span className="text-muted">Account number:</span> <span className="font-semibold">{selectedPayoutAccount.number}</span></p>
              <p className="pt-2 text-xs text-muted">No bank or e-wallet password is collected. Approve only after independently confirming these destination details with the owner.</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Review note for the owner</span>
              <textarea value={payoutAccountNote} onChange={(event) => setPayoutAccountNote(event.target.value)} rows={3} maxLength={500} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" placeholder="Record how the destination was verified, or explain the rejection." />
            </label>
            {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={isSubmitting} onClick={() => setSelectedPayoutAccount(null)}>Cancel</Button>
              <Button variant="danger" disabled={isSubmitting || !payoutAccountNote.trim()} onClick={() => reviewPayoutAccount('reject')}>Reject</Button>
              <Button disabled={isSubmitting || !payoutAccountNote.trim()} onClick={() => reviewPayoutAccount('approve')}>{isSubmitting ? 'Saving…' : 'Approve destination'}</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedDispute)}
        onClose={() => {
          if (!isSubmitting) {
            setSelectedDispute(null)
            setActionError('')
          }
        }}
        title="Review booking dispute"
        className="max-h-[90vh] overflow-y-auto"
      >
        {selectedDispute ? (
          <form className="space-y-4" onSubmit={submitDisputeAction}>
            <div className="space-y-1 text-sm">
              <p><span className="text-muted">User:</span> {selectedDispute.user}</p>
              <p><span className="text-muted">Owner:</span> {selectedDispute.owner || selectedDispute.ownerId}</p>
              <p><span className="text-muted">Facility:</span> {selectedDispute.facility}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg p-1">
              <button type="button" onClick={() => setDisputeSide('user')} className={`rounded px-3 py-2 text-xs font-semibold ${disputeSide === 'user' ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}>User side</button>
              <button type="button" onClick={() => setDisputeSide('owner')} className={`rounded px-3 py-2 text-xs font-semibold ${disputeSide === 'owner' ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}>Owner side</button>
            </div>
            {isLoadingDispute ? <p role="status" className="text-xs text-muted">Loading both sides and proof...</p> : null}
            {disputeSide === 'user' ? <div className="rounded-md border border-border bg-bg p-3 text-sm"><h3 className="font-semibold">User complaint · {selectedDispute.reason}</h3><p className="mt-2 whitespace-pre-wrap">{selectedDispute.details}</p><DisputeEvidenceGallery title="User proof" items={selectedDispute.userEvidence ?? []} /></div> : (
              selectedDispute.ownerResponse ? <div className="rounded-md border border-border bg-bg p-3 text-sm"><h3 className="font-semibold">Owner response</h3><p className="mt-2 whitespace-pre-wrap">{selectedDispute.ownerResponse.details}</p><DisputeEvidenceGallery title="Owner proof" items={selectedDispute.ownerEvidence ?? []} /></div>
                : <p className="rounded-md border border-border bg-bg p-3 text-sm text-muted">The facility owner has not submitted their side yet.</p>
            )}
            {disputeReservation ? (
              <FeeBreakdown rows={[
                { label: 'Facility', value: disputeReservation.name ?? selectedDispute.facility },
                { label: 'Date', value: disputeReservation.date ?? 'Unavailable' },
                { label: 'Court rate', value: formatPHP(disputeReservation.courtRate ?? 0) },
                { label: 'Service fee', value: formatPHP(disputeReservation.serviceFee ?? 0) },
                { label: 'Owner commission', value: formatPHP(disputeReservation.ownerCommission ?? 0) },
                { label: 'Owner net', value: formatPHP(disputeReservation.ownerNet ?? 0) },
                { label: 'Total paid', value: formatPHP(disputeReservation.userTotal ?? 0), emphasis: true },
              ]} />
            ) : <p role="alert" className="text-sm text-danger">The reservation record could not be loaded.</p>}
            {selectedDispute.ownerResponse?.submittedAt ? <>
              <div>
                <h3 className="mb-2 text-xs font-semibold text-muted">Your decision</h3>
                <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border">
                  {[
                    ['full-refund', 'Full refund'],
                    ['partial-refund', 'Partial refund'],
                    ['reject', 'Reject'],
                  ].map(([action, label]) => <button key={action} type="button" onClick={() => {
                    setDisputeAction(action)
                    if (action === 'partial-refund') setPartialAmount((Number(disputeReservation?.paidAmount ?? disputeReservation?.userTotal ?? 0) / 2).toFixed(2))
                  }} className={`border-r border-border px-2 py-3 text-xs font-semibold last:border-r-0 ${disputeAction === action ? 'bg-accent text-white' : 'bg-bg text-text hover:bg-surface'}`}>{label}</button>)}
                </div>
              </div>
            {disputeAction === 'partial-refund' ? (
              <Input
                label="Partial refund amount (₱)"
                type="number"
                value={partialAmount}
                onChange={(event) => setPartialAmount(event.target.value)}
                min="0.01"
                max={disputeReservation?.paidAmount ?? disputeReservation?.userTotal}
                step="0.01"
                required
              />
            ) : null}
            <div>
              <label htmlFor="dispute-audit-note" className="mb-1.5 block text-xs font-medium text-muted">Note to both sides</label>
              <textarea
                id="dispute-audit-note"
                value={disputeNote}
                onChange={(event) => setDisputeNote(event.target.value)}
                rows={3}
                maxLength={1000}
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={isSubmitting} onClick={() => setSelectedDispute(null)}>Cancel</Button>
              <Button
                type="submit"
                disabled={isSubmitting || !disputeAction || !disputeNote.trim() || !disputeReservation}
              >
                {isSubmitting ? 'Saving…' : 'Record resolution'}
              </Button>
            </div>
            </> : <p role="status" className="rounded-md border border-border bg-bg p-3 text-sm text-muted">Resolution is locked until the facility owner submits their response.</p>}
            {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
          </form>
        ) : null}
      </Modal>
      <ReservationPaymentAuditModal
        open={Boolean(auditReservationId)}
        reservationId={auditReservationId}
        onClose={() => setAuditReservationId(null)}
      />
    </div>
  )
}

export default AdminRevenuePage

function formatDisputeDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
