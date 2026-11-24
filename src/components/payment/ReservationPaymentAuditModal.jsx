import { useEffect, useState } from 'react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import { reservationService } from '../../services/reservationService'
import { formatPHP } from '../../utils/fees'

const statusTone = (status = '') => {
  const normalized = status.toLowerCase()
  if (['paid', 'released', 'completed'].includes(normalized)) return 'success'
  if (['pending', 'pending verification', 'held', 'processing'].includes(normalized)) return 'pending'
  if (['refunded', 'partially refunded', 'failed', 'rejected', 'cancelled'].includes(normalized)) return 'danger'
  return 'neutral'
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-PH')
}

function Evidence({ title, proof }) {
  const image = typeof proof?.image === 'string' ? proof.image : ''
  if (!image) return null
  return (
    <div className="mt-3 rounded-md border border-border bg-bg/50 p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      <a href={image} target="_blank" rel="noreferrer" className="inline-block">
        <img src={image} alt={title} className="max-h-72 max-w-full rounded border border-border object-contain" />
      </a>
      {proof.reference ? <p className="mt-2 text-xs text-muted">Receipt reference: {proof.reference}</p> : null}
      {proof.uploadedAt ? <p className="mt-1 text-xs text-muted">Uploaded {formatDate(proof.uploadedAt)}</p> : null}
    </div>
  )
}

function ReservationPaymentAuditModal({ open, onClose, reservationId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !reservationId) return undefined
    let active = true
    setLoading(true)
    setData(null)
    setError('')
    reservationService.getPaymentAudit(reservationId)
      .then((result) => { if (active) setData(result) })
      .catch((requestError) => { if (active) setError(requestError.message || 'Payment records could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, reservationId])

  const reservation = data?.reservation
  const payments = data?.payments ?? []
  const ledger = data?.ledger ?? []
  const disputeResolution = data?.disputeResolution

  return (
    <Modal open={open} onClose={onClose} title="Booking receipt & audit" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      {loading ? <p role="status" className="text-sm text-muted">Loading booking payment records…</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {reservation ? (
        <div className="space-y-5">
          <section className="grid gap-3 rounded-md border border-border bg-bg/40 p-3 text-sm sm:grid-cols-2">
            <p><span className="text-muted">Reservation:</span> #{reservation.id}</p>
            <p><span className="text-muted">Status:</span> <Badge tone={statusTone(reservation.status)}>{reservation.status}</Badge></p>
            <p><span className="text-muted">Customer:</span> {reservation.customer}</p>
            <p><span className="text-muted">Facility:</span> {reservation.facility}</p>
            <p><span className="text-muted">Booking date:</span> {reservation.date || '—'}</p>
            <p><span className="text-muted">Created:</span> {formatDate(reservation.createdAt)}</p>
            {reservation.totalAmount != null ? <p><span className="text-muted">Rental charges:</span> {formatPHP(reservation.totalAmount)}</p> : null}
            {reservation.courtCharges != null ? <p><span className="text-muted">Court charges:</span> {formatPHP(reservation.courtCharges)}</p> : null}
            {reservation.equipmentItems?.length ? <div className="sm:col-span-2"><p className="text-muted">Equipment rentals:</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{reservation.equipmentItems.map((item, index) => <div key={`${item.id ?? item.itemName}-${index}`} className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-bg/40 p-2">{item.image ? <img src={item.image} alt={item.itemName} className="h-24 w-32 shrink-0 rounded-md object-cover" /> : null}<div className="min-w-0 flex-1"><p className="font-medium">{item.categoryName} · {item.itemName} × {item.quantity}{item.billingUnit === 'hour' ? ` · ${item.billedHours} hr` : ''}</p><p className="mt-1 text-xs text-muted">{formatPHP(item.unitPrice)} / {item.billingUnit === 'hour' ? 'hour' : 'item'}</p></div><strong className="shrink-0">{formatPHP(item.lineTotal)}</strong></div>)}</div><p className="mt-1 text-right font-semibold">Equipment total: {formatPHP(reservation.equipmentTotal)}</p></div> : null}
            {reservation.promo ? <p><span className="text-muted">Promo:</span> {reservation.promo.code} · savings {formatPHP(reservation.promo.discountAmount)}</p> : null}
            {reservation.userTotal != null ? <p><span className="text-muted">Total after discounts:</span> {formatPHP(reservation.userTotal)}</p> : null}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold">Payments and receipts</h3>
              <p className="mt-1 text-xs text-muted">Payment status and timestamps come from the reservation payment records. Uploaded receipts are shown when available.</p>
            </div>
            {payments.length ? payments.map((payment) => (
              <article key={payment.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">{String(payment.paymentType || 'Payment').replaceAll('_', ' ')} · {formatPHP(payment.amount)}</p>
                    <p className="text-xs text-muted">Method: {payment.method || 'Not recorded'}</p>
                    <p className="text-xs text-muted">Reference: {payment.reference || payment.proof?.reference || '—'}</p>
                    <p className="text-xs text-muted">Recorded: {formatDate(payment.createdAt)}{payment.paidAt ? ` · Paid: ${formatDate(payment.paidAt)}` : ''}</p>
                  </div>
                  <Badge tone={statusTone(payment.status)}>{payment.status}</Badge>
                </div>
                <Evidence title="Uploaded payment receipt" proof={payment.proof} />
                <Evidence title="Refund evidence" proof={payment.refundProof} />
              </article>
            )) : <p className="rounded-md border border-border p-3 text-sm text-muted">No payment records have been recorded for this booking yet.</p>}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold">Financial audit log</h3>
              <p className="mt-1 text-xs text-muted">Recorded customer payments, fees, owner balance holds/releases, refunds, and related ledger updates.</p>
            </div>
            {ledger.length ? (
              <ol className="space-y-2">
                {ledger.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg/40 p-3 text-sm">
                    <div>
                      <p className="font-medium">{String(entry.type || 'Ledger entry').replaceAll('_', ' ')}</p>
                      <p className="mt-1 text-xs text-muted">{formatDate(entry.createdAt)}{entry.reference ? ` · Ref ${entry.reference}` : ''}{entry.paymentId ? ` · Payment #${entry.paymentId}` : ''}</p>
                      {entry.metadata?.reason ? <p className="mt-1 text-xs text-muted">Reason: {entry.metadata.reason}</p> : null}
                      {entry.metadata?.resolution ? <p className="mt-1 text-xs text-muted">Resolution: {entry.metadata.resolution}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatPHP(entry.amount)}</span>
                      <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-md border border-border p-3 text-sm text-muted">No ledger audit entries are available for this booking.</p>}
          </section>
          {disputeResolution ? <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="text-sm font-bold">Dispute decision audit</h3>
            <p className="text-sm">{disputeResolution.resolution === 'reject' ? 'Rejected — no refund approved.' : `${disputeResolution.resolution === 'full-refund' ? 'Full' : 'Partial'} refund approved: ${formatPHP(disputeResolution.refund?.totalRefunded ?? 0)}.`}</p>
            <p className="text-xs text-muted">Recorded {formatDate(disputeResolution.resolvedAt)}</p>
            {disputeResolution.note ? <p className="whitespace-pre-wrap text-sm text-muted">Note to both sides: {disputeResolution.note}</p> : null}
          </section> : null}
        </div>
      ) : null}
    </Modal>
  )
}

export default ReservationPaymentAuditModal
