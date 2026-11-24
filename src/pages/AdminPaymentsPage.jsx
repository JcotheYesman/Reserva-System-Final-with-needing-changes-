import { useCallback, useMemo, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { adminService } from '../services/adminService'
import { formatPHP } from '../utils/fees'

const EMPTY_PAYMENTS = []

function AdminPaymentsPage() {
  const loader = useCallback(() => adminService.getPayments(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [query, setQuery] = useState('')
  const [proof, setProof] = useState(null)
  const [actionError, setActionError] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [busy, setBusy] = useState(false)
  const payments = data ?? EMPTY_PAYMENTS
  const selectedPayment = payments.find((payment) => Number(payment.id) === Number(proof?.paymentId))
  const visiblePayments = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? payments.filter((payment) => `${payment.id} ${payment.customer} ${payment.facility} ${payment.method} ${payment.paymentType ?? ''}`.toLowerCase().includes(term)) : payments
  }, [payments, query])
  const columns = [
    { key: 'id', label: 'Payment ID', className: 'whitespace-nowrap font-semibold' },
    { key: 'customer', label: 'Customer' },
    { key: 'facility', label: 'Facility' },
    { key: 'date', label: 'Date', className: 'whitespace-nowrap' },
    { key: 'method', label: 'Method' },
    { key: 'paymentType', label: 'Payment type', render: (payment) => ({ full: 'Full payment', downpayment: '50% downpayment', balance: 'Balance', legacy: 'Previously submitted' }[payment.paymentType] ?? '—') },
    { key: 'reference', label: 'Reference', className: 'max-w-40 truncate text-xs text-muted', render: (payment) => payment.reference || '—' },
    { key: 'amount', label: 'Amount', className: 'whitespace-nowrap text-right font-semibold text-accent', render: (payment) => Number.isFinite(payment.amount) ? formatPHP(payment.amount) : '—' },
    { key: 'status', label: 'Status', render: (payment) => <Badge tone={payment.status === 'Paid' ? 'success' : ['Refunded', 'Failed'].includes(payment.status) ? 'danger' : 'pending'}>{payment.status}</Badge> },
    { key: 'evidence', label: 'Evidence', render: (payment) => <div className="flex gap-1.5">{payment.hasProof && payment.type !== 'refund' ? <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => openProof(payment, 'payment')}>Receipt</Button> : null}{payment.hasRefundProof ? <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => openProof(payment, 'refund')}>Refund proof</Button> : null}{!payment.hasProof && !payment.hasRefundProof ? <span className="text-xs text-muted">—</span> : null}</div> },
  ]

  async function openProof(payment, kind) {
    try {
      setActionError('')
      setRejectionReason('')
      setProof({ ...(await adminService.getPaymentProof(payment.proofPaymentId ?? payment.id, kind)), kind })
    } catch (error) {
      setActionError(error.message || 'Receipt could not be loaded.')
    }
  }

  async function verifyProof() {
    if (!proof?.paymentId) return
    setBusy(true)
    setActionError('')
    try {
      await adminService.verifyPayment(proof.paymentId)
      setProof(null)
      reload()
    } catch (error) {
      setActionError(error.message || 'Payment could not be verified.')
    } finally {
      setBusy(false)
    }
  }

  async function rejectProof() {
    if (!proof?.paymentId || !rejectionReason.trim()) return
    setBusy(true)
    setActionError('')
    try {
      await adminService.rejectPayment(proof.paymentId, rejectionReason.trim())
      setProof(null)
      setRejectionReason('')
      reload()
    } catch (rejectError) {
      setActionError(rejectError.message || 'Payment proof could not be rejected.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading title="Payment Records" description="View payment activity recorded for facility reservations." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted">{payments.length} payment records</p>
        <label className="block w-full sm:w-72"><span className="mb-1.5 block text-xs font-medium text-muted">Search payments</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Payment, customer, or facility" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" /></label>
      </div>
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !visiblePayments.length} emptyMessage={query ? 'No payments match your search.' : 'No payment records yet.'} />
      {!isLoading && !error && visiblePayments.length ? <Table columns={columns} rows={visiblePayments} rowKey="id" caption="Facility reservation payments" /> : null}
      {actionError && !proof ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      <p className="text-[10px] leading-4 text-muted">GCash and Maya transfer proofs remain pending until an administrator verifies them. RESERVA has no configured card processor, so no card charge is simulated.</p>
      <Modal open={Boolean(proof)} onClose={() => { if (!busy) setProof(null) }} title={proof?.kind === 'refund' ? 'Refund receipt evidence' : 'Payment receipt evidence'}>
        {proof ? <div className="space-y-3">
          <img src={proof.image} alt="Uploaded payment receipt" className="max-h-[55vh] w-full rounded border border-border bg-bg object-contain" />
          {proof.reference ? <p className="text-xs text-muted">Reference: <strong className="text-text">{proof.reference}</strong></p> : null}
          {proof.rejectionReason ? <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">Previous rejection: {proof.rejectionReason}</p> : null}
          {proof.kind !== 'refund' && selectedPayment?.status === 'Pending' ? <label className="block text-xs font-medium text-muted">Reject reason<textarea value={rejectionReason} maxLength={1000} onChange={(event) => setRejectionReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-border bg-bg p-2 text-sm text-text" placeholder="Explain what needs to be corrected" /></label> : null}
          {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setProof(null)}>Close</Button>{proof.kind !== 'refund' && selectedPayment?.status === 'Pending' ? <><Button variant="danger" disabled={busy || !rejectionReason.trim()} onClick={rejectProof}>{busy ? 'Saving…' : 'Reject proof'}</Button><Button disabled={busy} onClick={verifyProof}>{busy ? 'Verifying…' : 'Verify payment'}</Button></> : null}</div>
        </div> : null}
      </Modal>
    </div>
  )
}

export default AdminPaymentsPage
