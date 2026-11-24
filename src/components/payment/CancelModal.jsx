import Button from '../ui/Button'
import Modal from '../ui/Modal'
import FeeBreakdown from './FeeBreakdown'
import { formatPHP } from '../../utils/fees'

function CancelModal({
  reservation,
  preview,
  loading,
  error,
  submitting,
  onClose,
  onConfirm,
}) {
  const totalRefunded = Number(preview?.totalRefunded ?? 0)
  const retainedAmount = Number(preview?.retainedAmount ?? preview?.retainedDeposit ?? 0)

  return (
    <Modal open={Boolean(reservation)} onClose={onClose} title="Cancel reservation">
      {reservation ? (
        <div>
          <p className="text-sm text-muted">
            Cancel your booking at <span className="font-semibold text-text">{reservation.name}</span>?
          </p>
          {loading ? <p role="status" className="mt-3 text-sm text-muted">Loading refund preview…</p> : null}
          {preview ? (
            <>
              <FeeBreakdown rows={[
                { label: 'Court rate', value: formatPHP(preview.courtRate) },
                { label: 'Service fee refund', value: formatPHP(preview.serviceFeeRefund ?? 0) },
                { label: 'Court rate refund', value: formatPHP(preview.courtRateRefund ?? 0) },
                { label: 'Paid amount retained', value: formatPHP(retainedAmount) },
                { label: 'You will be refunded', value: formatPHP(totalRefunded), emphasis: true },
              ]} />
              {totalRefunded > 0 ? <p className="mt-2 text-xs leading-5 text-muted">The refund will be recorded as pending until it is processed and confirmed. No refund is sent automatically by this system.</p> : null}
              <p className="mt-1 text-xs leading-5 text-muted">{preview.reason}</p>
            </>
          ) : null}
          {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={submitting} onClick={onClose}>Keep booking</Button>
            <Button
              variant="danger"
              disabled={submitting || loading || !preview}
              onClick={onConfirm}
            >
              {submitting ? 'Cancelling…' : 'Confirm cancellation'}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export default CancelModal
