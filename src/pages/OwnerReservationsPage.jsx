import { useCallback, useEffect, useMemo, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { reservationService } from '../services/reservationService'
import { settingsService } from '../services/settingsService'
import { formatPHP } from '../utils/fees'

const statusTone = { Confirmed: 'success', Pending: 'pending', Cancelled: 'danger', Completed: 'success', 'No-show': 'danger' }
const EMPTY_RESERVATIONS = []

function OwnerReservationsPage() {
  const loader = useCallback(async () => {
    const [reservations, settings] = await Promise.all([
      reservationService.getOwnerReservations(),
      settingsService.getSettings(),
    ])
    return {
      reservations: reservations.map(toOwnerRow),
      requestExpiryHours: settings.refundPolicy.requestExpiryHours,
    }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [filter, setFilter] = useState('All')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedAction, setSelectedAction] = useState('decline')
  const [reason, setReason] = useState('')
  const [refundProof, setRefundProof] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  const [paymentProof, setPaymentProof] = useState(null)
  const [cashReservation, setCashReservation] = useState(null)
  const [cashAmount, setCashAmount] = useState('')
  const [cashProof, setCashProof] = useState('')
  const [cashRequestId, setCashRequestId] = useState('')
  const [cashError, setCashError] = useState('')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const reservations = data?.reservations ?? EMPTY_RESERVATIONS
  const filteredReservations = useMemo(
    () => filter === 'All' ? reservations : reservations.filter((reservation) => reservation.status === filter),
    [filter, reservations],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  async function openCancellation(reservation) {
    setSelected(reservation)
    setSelectedAction('decline')
    setReason('')
    setRefundProof('')
    setActionError('')
  }

  function openNoShow(reservation) {
    setSelected(reservation)
    setSelectedAction('no-show')
    setReason('')
    setRefundProof('')
    setActionError('')
  }

  async function openProof(reservation) {
    setActionError('')
    try {
      setPaymentProof(await reservationService.getPaymentProof(reservation.paymentId))
    } catch (proofError) {
      setActionError(proofError instanceof Error ? proofError.message : 'Receipt evidence could not be loaded.')
    }
  }

  async function verifyDeposit(proof) {
    if (!proof?.paymentId) return
    setPaymentBusy(true)
    setActionError('')
    try {
      await reservationService.verifyPayment(proof.paymentId)
      setPaymentProof(null)
      reload()
    } catch (verifyError) {
      setActionError(verifyError instanceof Error ? verifyError.message : 'The deposit could not be verified.')
    } finally {
      setPaymentBusy(false)
    }
  }

  function openCashPayment(reservation) {
    setCashReservation(reservation)
    setCashAmount(String(reservation.balanceDue ?? 0))
    setCashProof('')
    setCashRequestId(crypto.randomUUID())
    setCashError('')
  }

  async function saveCashPayment(event) {
    event.preventDefault()
    if (!cashReservation || !cashProof) {
      setCashError('Upload a photo of the cash receipt before recording this payment.')
      return
    }
    setPaymentBusy(true)
    setCashError('')
    try {
      await reservationService.recordCashPayment({
        reservationId: cashReservation.id,
        amount: Number(cashAmount),
        paymentProof: cashProof,
        requestId: cashRequestId,
      })
      setCashReservation(null)
      reload()
    } catch (recordError) {
      setCashError(recordError instanceof Error ? recordError.message : 'The cash payment could not be recorded.')
    } finally {
      setPaymentBusy(false)
    }
  }

  async function updateStatus(reservation, status) {
    setBusyId(reservation.id)
    setActionError('')
    try {
      await reservationService.updateOwnerReservationStatus(reservation.id, status, reason, status === 'Cancelled' && Number(reservation.paidAmount ?? 0) > 0 ? refundProof : null)
      setSelected(null)
      setReason('')
      reload()
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : 'Reservation status could not be updated.')
    } finally {
      setBusyId(null)
    }
  }

  const columns = [
    { key: 'customer', label: 'Customer' },
    { key: 'facility', label: 'Facility' },
    { key: 'date', label: 'Date' },
    {
      key: 'time',
      label: 'Time',
      render: (reservation) => reservation.courtSchedules?.length ? (
        <div className="min-w-36 space-y-1 text-xs">
          {reservation.courtSchedules.map((court, index) => (
            <p key={court.courtId ?? index}>Court {court.courtNumber ?? index + 1}: {court.startTime} - {court.endTime}</p>
          ))}
        </div>
      ) : reservation.time,
    },
    { key: 'duration', label: 'Total court hours' },
    {
      key: 'requestDeadline',
      label: 'Response deadline',
      render: (reservation) => reservation.status === 'Pending'
        ? getCountdown(reservation.createdAt, data.requestExpiryHours, clock)
        : '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (reservation) => <Badge tone={statusTone[reservation.status] ?? 'neutral'}>{reservation.status}</Badge>,
    },
    {
      key: 'total',
      label: 'Total',
      className: 'text-right font-semibold text-accent',
      render: (reservation) => formatPHP(reservation.courtRate ?? reservation.total ?? 0),
    },
    {
      key: 'payment',
      label: 'Deposit',
      render: (reservation) => reservation.paymentStatus === 'pending' && reservation.hasPaymentProof && reservation.paymentId
          ? <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => openProof(reservation)}>Review receipt</Button>
          : Number(reservation.paidAmount ?? 0) >= Number(reservation.depositAmount ?? 0) && Number(reservation.depositAmount ?? 0) > 0
            ? <Badge tone="success">{reservation.paymentOption === 'half' && Number(reservation.balanceDue ?? 0) > 0 ? 'Downpayment verified' : 'Paid'}</Badge>
          : <span className="text-xs text-muted">No proof</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'text-right',
      render: (reservation) => reservation.status === 'Pending' ? (
        <div className="flex justify-end gap-1.5">
          <Button
            disabled={busyId === reservation.id || Number(reservation.paidAmount ?? 0) < Number(reservation.depositAmount ?? 0)}
            title={Number(reservation.paidAmount ?? 0) < Number(reservation.depositAmount ?? 0) ? 'Verify the required deposit before accepting.' : undefined}
            onClick={() => updateStatus(reservation, 'Confirmed')}
            className="px-2 py-1.5 text-xs"
          >
            {busyId === reservation.id ? 'Saving…' : 'Accept'}
          </Button>
          <Button
            variant="danger"
            disabled={busyId === reservation.id}
            onClick={() => openCancellation(reservation)}
            className="px-2 py-1.5 text-xs"
          >
            Decline
          </Button>
        </div>
      ) : ['Confirmed', 'Checked in'].includes(reservation.status) ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {Number(reservation.balanceDue ?? 0) > 0 && reservation.paymentOption === 'half' && reservation.balanceSettlement === 'cash-checkin' ? <Button variant="secondary" disabled={paymentBusy} onClick={() => openCashPayment(reservation)} className="px-2 py-1.5 text-xs">Record cash balance</Button> : null}
          {reservation.status === 'Confirmed' && new Date(`${reservation.date}T${reservation.endTime}:00`).getTime() <= clock ? <Button variant="danger" disabled={busyId === reservation.id} onClick={() => openNoShow(reservation)} className="px-2 py-1.5 text-xs">Mark no-show</Button> : null}
          {reservation.status === 'Confirmed' && new Date(`${reservation.date}T${reservation.endTime}:00`).getTime() > clock ? <span className="text-xs text-muted">Customer manages cancellation</span> : null}
        </div>
      ) : <span className="text-xs text-muted">—</span>,
    },
  ]

  const pendingCount = reservations.filter((item) => item.status === 'Pending').length
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeading title="Reservation Requests" description="Review requests, accept bookings, or decline/cancel with a reason." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted">{pendingCount} requests need your attention</p>
        <div className="w-full sm:w-52">
          <Select
            label="Show"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            options={['All', 'Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-show']}
          />
        </div>
      </div>
      {actionError && !selected ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
      <AsyncState
        loading={isLoading}
        error={error}
        onRetry={reload}
        empty={!isLoading && !error && filteredReservations.length === 0}
        emptyMessage="There are no reservations in this view."
      />
      {!isLoading && !error && filteredReservations.length ? (
        <Table columns={columns} rows={filteredReservations} rowKey="id" caption="Facility reservations" />
      ) : null}
      <Modal
        open={Boolean(selected)}
        onClose={() => {
          if (!busyId) {
            setSelected(null)
            setActionError('')
          }
        }}
        title={selectedAction === 'no-show' ? 'Mark reservation as no-show' : 'Decline reservation request'}
      >
        {selected ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {selectedAction === 'no-show' ? 'Marking the reservation as no-show for ' : 'Declining the booking for '}
              <span className="font-semibold text-text">{selected.customer}</span> at {selected.facility}.
              {' '}{selectedAction === 'no-show' ? 'The saved no-show refund policy will be applied; any refund remains pending until it is actually processed.' : `The customer will be notified. ${Number(selected.paidAmount ?? 0) > 0 ? 'Upload proof of refunding their verified payment to decline this paid request.' : ''}`}
            </p>
            <div>
              <label htmlFor="owner-cancellation-reason" className="mb-1.5 block text-xs font-medium text-muted">
                Reason
              </label>
              <textarea
                id="owner-cancellation-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>
            {selectedAction === 'decline' && Number(selected.paidAmount ?? 0) > 0 ? <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Deposit refund receipt (required)</span><input type="file" accept="image/png,image/jpeg,image/webp" required disabled={Boolean(busyId)} onChange={async (event) => { try { setRefundProof(await compressReceipt(event.target.files?.[0])); setActionError('') } catch (imageError) { setActionError(imageError.message || 'Refund receipt could not be prepared.') } }} className="block w-full rounded-md border border-border bg-bg p-2 text-xs text-text" /></label> : null}
            {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={Boolean(busyId)}
                onClick={() => setSelected(null)}
              >
                Keep booking
              </Button>
              <Button
                variant="danger"
                disabled={
                  Boolean(busyId) || !reason.trim() || (selectedAction === 'decline' && Number(selected.paidAmount ?? 0) > 0 && !refundProof)
                }
                onClick={() => updateStatus(selected, selectedAction === 'no-show' ? 'No-show' : 'Cancelled')}
              >
                {busyId ? 'Processing…' : selectedAction === 'no-show' ? 'Confirm no-show' : 'Confirm decline'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(paymentProof)} onClose={() => { if (!paymentBusy) setPaymentProof(null) }} title="Review deposit receipt">
        {paymentProof ? <div className="space-y-3">
          <p className="text-sm text-muted">Compare the receipt with the payment reference before verifying the deposit.</p>
          <img src={paymentProof.image} alt="Uploaded payment receipt" className="max-h-[55vh] w-full rounded border border-border bg-bg object-contain" />
          {paymentProof.reference ? <p className="text-xs text-muted">Reference: <strong className="text-text">{paymentProof.reference}</strong></p> : null}
          {actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={paymentBusy} onClick={() => setPaymentProof(null)}>Close</Button><Button disabled={paymentBusy} onClick={() => verifyDeposit(paymentProof)}>{paymentBusy ? 'Verifying…' : 'Verify deposit'}</Button></div>
        </div> : null}
      </Modal>
      <Modal open={Boolean(cashReservation)} onClose={() => { if (!paymentBusy) setCashReservation(null) }} title="Record cash balance payment">
        {cashReservation ? <form onSubmit={saveCashPayment} className="space-y-3">
          <p className="text-sm text-muted">Record cash received from {cashReservation.customer} for {cashReservation.facility}. Upload its receipt.</p>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Remaining balance due</span><input type="text" readOnly value={formatPHP(cashReservation.balanceDue ?? 0)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Cash receipt photo (required)</span><input type="file" accept="image/png,image/jpeg,image/webp" required disabled={paymentBusy} onChange={async (event) => { try { setCashProof(await compressReceipt(event.target.files?.[0])); setCashError('') } catch (imageError) { setCashError(imageError.message || 'Receipt image could not be prepared.') } }} className="block w-full rounded-md border border-border bg-bg p-2 text-xs text-text" /></label>
          {cashError ? <p role="alert" className="text-sm text-danger">{cashError}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={paymentBusy} onClick={() => setCashReservation(null)}>Close</Button><Button type="submit" disabled={paymentBusy || !cashProof}>{paymentBusy ? 'Recording…' : 'Record payment'}</Button></div>
        </form> : null}
      </Modal>
    </div>
  )
}

function toOwnerRow(reservation) {
  const courtHours = reservation.courtSchedules?.length
    ? reservation.courtSchedules.reduce((sum, court) => sum + Number(court.duration ?? 0), 0)
    : Number(reservation.duration ?? 0)
  return {
    ...reservation,
    isPaymentReservation: true,
    customer: reservation.user || reservation.customer || 'Player',
    facility: reservation.name || reservation.facility || 'Facility unavailable',
    total: reservation.courtRate ?? reservation.total,
    time: `${reservation.startTime} - ${reservation.endTime}`,
    duration: `${courtHours} ${courtHours === 1 ? 'hr' : 'hrs'}`,
  }
}

function getCountdown(createdAt, expiryHours, now) {
  if (!createdAt) return `${expiryHours}h response window`
  const expiresAt = new Date(createdAt).getTime() + Number(expiryHours) * 60 * 60 * 1000
  const remaining = expiresAt - now
  if (!Number.isFinite(expiresAt) || remaining <= 0) return 'Expiring…'
  const totalSeconds = Math.floor(remaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}h ${minutes}m ${seconds}s`
}

export default OwnerReservationsPage

async function compressReceipt(file) {
  if (!file) throw new Error('Choose a receipt image.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The receipt image could not be prepared.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let quality = 0.82
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > 680000 && quality > 0.4) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > 680000) throw new Error('Receipt image is too large. Choose a smaller photo.')
  return dataUrl
}
