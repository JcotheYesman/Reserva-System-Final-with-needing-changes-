import { useCallback, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import CancelModal from '../components/payment/CancelModal'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import useAsyncResource from '../hooks/useAsyncResource'
import { facilityService } from '../services/facilityService'
import { paymentService } from '../services/paymentService'
import { reservationService } from '../services/reservationService'
import { formatPHP } from '../utils/fees'

const statusTone = { Confirmed: 'success', Pending: 'pending', Completed: 'success', Cancelled: 'danger', 'No-show': 'danger' }

function ReservedSchedulePage() {
  const location = useLocation()
  const loader = useCallback(async () => {
    const [reservations, facilities, savedMethods] = await Promise.all([
      reservationService.getReservedSchedule(),
      facilityService.getFacilities(),
      paymentService.getSavedPaymentMethods(),
    ])
    const facilitiesById = new Map(facilities.map((facility) => [String(facility.id), facility]))
    return { reservations: reservations.map((reservation) => {
      const facility = facilitiesById.get(String(reservation.facilityId))
      return {
        ...reservation,
        image: facility?.image ?? reservation.image ?? null,
        facilityColor: facility?.color ?? null,
        sport: reservation.sport ?? facility?.sport ?? '',
      }
    }), savedMethods }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const reservations = data?.reservations ?? []
  const [selected, setSelected] = useState(null)
  const [refundPreview, setRefundPreview] = useState(null)
  const [cancelError, setCancelError] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  const [balanceReservation, setBalanceReservation] = useState(null)
  const [resubmitReservation, setResubmitReservation] = useState(null)
  const [balanceMethod, setBalanceMethod] = useState('GCash')
  const [balanceSavedMethodId, setBalanceSavedMethodId] = useState('')
  const [balanceProof, setBalanceProof] = useState(null)
  const [balanceReference, setBalanceReference] = useState('')
  const [balanceRequestId, setBalanceRequestId] = useState('')
  const [balanceError, setBalanceError] = useState('')
  const [balanceBusy, setBalanceBusy] = useState(false)
  const [preparingBalanceProof, setPreparingBalanceProof] = useState(false)

  function openBalancePayment(reservation) {
    const preferred = data?.savedMethods?.find((method) => method.isDefault) ?? data?.savedMethods?.[0]
    setBalanceReservation(reservation)
    setBalanceMethod(preferred?.methodType ?? 'GCash')
    setBalanceSavedMethodId(preferred ? String(preferred.id) : '')
    setBalanceProof(null)
    setBalanceReference('')
    setBalanceRequestId(crypto.randomUUID())
    setBalanceError('')
  }

  function openResubmitProof(reservation) {
    const preferredType = ['GCash', 'Maya'].includes(reservation.paymentMethod) ? reservation.paymentMethod : 'GCash'
    const preferred = data?.savedMethods?.find((method) => method.methodType === preferredType && method.isDefault)
      ?? data?.savedMethods?.find((method) => method.methodType === preferredType)
    setResubmitReservation(reservation)
    setBalanceReservation(null)
    setBalanceMethod(preferredType)
    setBalanceSavedMethodId(preferred ? String(preferred.id) : '')
    setBalanceProof(null)
    setBalanceReference('')
    setBalanceRequestId(crypto.randomUUID())
    setBalanceError('')
  }

  async function saveBalanceProof(event) {
    event.preventDefault()
    if ((!balanceReservation && !resubmitReservation) || !balanceProof || !balanceRequestId) {
      setBalanceError('Upload the transfer receipt before submitting it for verification.')
      return
    }
    setBalanceBusy(true)
    setBalanceError('')
    try {
      if (resubmitReservation) {
        await paymentService.resubmitProof({ paymentId: resubmitReservation.paymentId, paymentProof: balanceProof.data, reference: balanceReference.trim() })
      } else {
        await paymentService.submitBalanceProof({
          reservationId: balanceReservation.id,
          paymentMethod: balanceMethod,
          savedPaymentMethodId: balanceSavedMethodId || null,
          paymentProof: balanceProof.data,
          reference: balanceReference.trim(),
          requestId: balanceRequestId,
        })
      }
      setBalanceReservation(null)
      setResubmitReservation(null)
      setNotice(resubmitReservation ? 'Corrected payment proof submitted. It will remain pending until it is verified.' : 'Balance payment proof submitted. It will remain pending until an administrator verifies it.')
      reload()
    } catch (submitError) {
      setBalanceError(submitError instanceof Error ? submitError.message : 'Balance proof could not be submitted.')
    } finally {
      setBalanceBusy(false)
    }
  }

  async function openCancel(reservation) {
    setSelected(reservation)
    setRefundPreview(null)
    setCancelError('')
    setNotice('')
    setIsLoadingPreview(true)
    try {
      setRefundPreview(await reservationService.getCancellationPreview(reservation.id))
    } catch (previewError) {
      setCancelError(previewError instanceof Error ? previewError.message : 'Refund preview could not be loaded.')
    } finally {
      setIsLoadingPreview(false)
    }
  }

  async function cancelReservation() {
    if (!selected) return
    setIsCancelling(true)
    setCancelError('')
    try {
      const result = await reservationService.cancelReservation(selected.id, 'user')
      setSelected(null)
      setNotice(result.reservation?.source === 'database'
        ? `Reservation cancelled. Refund ${formatPHP(result.refund.total)} is ${result.refund.total > 0 ? 'pending manual processing' : 'not due'}; ${formatPHP(result.refund.retainedAmount ?? 0)} of payments is retained under the saved policy.`
        : `Reservation cancelled. Refund: ${formatPHP(result.refund.total)}.`)
      reload()
    } catch (submitError) {
      setCancelError(submitError instanceof Error ? submitError.message : 'Reservation could not be cancelled.')
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading
        title="Reserved Schedule"
        description="Keep track of your upcoming games and bookings."
        action={
          <Link
            to="/sports-facilities"
            className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Book a facility
          </Link>
        }
      />
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !reservations.length} emptyMessage="You don't have any reservations yet." />
      {!isLoading && !error && reservations.length ? (
        <div className="grid grid-cols-1 gap-3">
          {reservations.map((reservation) => (
            <Card key={reservation.id} padded={false} className="grid min-w-0 overflow-hidden sm:min-h-[220px] sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div
                className="relative flex min-h-32 items-center justify-center overflow-hidden bg-gradient-to-br from-danger/70 to-sidebar sm:min-h-[220px]"
                style={{ backgroundColor: reservation.facilityColor || undefined }}
                aria-hidden="true"
              >
                <span className="text-2xl font-black text-white/75">{String(reservation.sport || 'Sports').slice(0, 2).toUpperCase()}</span>
                {reservation.image ? (
                  <img src={reservation.image} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none' }} className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col p-4 sm:min-h-[220px]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold">{reservation.name}</h2>
                    <p className="mt-1 text-xs text-muted">{reservation.date}</p>
                  </div>
                  <Badge tone={statusTone[reservation.status] ?? 'neutral'}>{reservation.status}</Badge>
                </div>
                {reservation.courtSchedules?.length ? (
                  <div className="mt-3 space-y-1 text-xs text-muted">
                    {reservation.courtSchedules.map((court, index) => (
                      <p key={court.courtId ?? index}>
                        Court {court.courtNumber ?? index + 1} · {reservation.date} · {court.startTime} - {court.endTime}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted">{reservation.time} · {reservation.quantity ?? 1} {(reservation.quantity ?? 1) === 1 ? 'court' : 'courts'}</p>
                )}
                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
                  <div className="shrink-0">
                    <p className="text-[10px] text-muted">Booking total</p>
                    <p className="mt-0.5 text-sm font-bold text-accent">
                      {Number.isFinite(Number(reservation.userTotal))
                        ? formatPHP(reservation.userTotal)
                        : reservation.total}
                    </p>
                    {['Pending', 'Confirmed'].includes(reservation.status) && reservation.paymentStatus === 'pending' && reservation.hasPaymentProof ? <p className="mt-1 text-[10px] text-amber-300">{reservation.paymentType === 'balance' ? 'Balance payment' : 'Initial payment'} {formatPHP(reservation.latestPaymentAmount ?? reservation.depositAmount ?? 0)} awaiting verification · balance {formatPHP(reservation.balanceDue ?? 0)}</p> : null}
                    {['Pending', 'Confirmed'].includes(reservation.status) && reservation.balanceDue > 0 && !(reservation.paymentStatus === 'pending' && reservation.hasPaymentProof) ? <p className="mt-1 text-[10px] text-muted">Paid {formatPHP(reservation.paidAmount ?? 0)} · balance {formatPHP(reservation.balanceDue)}</p> : null}
                    {reservation.balanceDue > 0 && reservation.paymentOption === 'half' && reservation.balanceSettlement === 'online-checkin' && reservation.status === 'Confirmed' && !(reservation.paymentType === 'balance' && reservation.paymentStatus === 'pending') ? <Button className="mt-2 px-2.5 py-1.5 text-[10px]" onClick={() => openBalancePayment(reservation)}>Submit balance proof</Button> : null}
                    {reservation.paymentStatus === 'failed' && reservation.paymentId && ['Pending', 'Confirmed'].includes(reservation.status) ? <Button variant="secondary" className="mt-2 px-2.5 py-1.5 text-[10px]" onClick={() => openResubmitProof(reservation)}>Resubmit payment proof</Button> : null}
                    {reservation.paymentStatus === 'refunded' ? <p className="mt-1 text-[10px] text-success">Deposit refund recorded</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {reservation.courtRate !== undefined && ['Pending', 'Confirmed'].includes(reservation.status) ? (
                      <Button
                        variant="danger"
                        className="shrink-0 whitespace-nowrap px-2.5 py-1.5 text-xs"
                        disabled={!isBeforeReservationStart(reservation)}
                        title={isBeforeReservationStart(reservation) ? undefined : 'This booking has already started.'}
                        onClick={() => openCancel(reservation)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {reservation.source === 'database' && ['Pending', 'Confirmed'].includes(reservation.status) && isBeforeReservationStart(reservation) ? (
                      <Link to={`/choose-schedule?facility=${reservation.facilityId}&reschedule=${reservation.id}&date=${reservation.date}&quantity=${reservation.quantity}`} className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text">Reschedule</Link>
                    ) : null}
                    {reservation.status === 'Completed' ? (
                      <Link to={`/feedback?reservation=${reservation.id}`} className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text">Review</Link>
                    ) : <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs text-muted">Review after completion</span>}
                    <Link
                      to={`/message-facility?facility=${reservation.facilityId ?? 1}`}
                      className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-info px-2.5 py-1.5 text-xs font-semibold text-white"
                    >
                      Message
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      <CancelModal
        reservation={selected}
        preview={refundPreview}
        loading={isLoadingPreview}
        error={cancelError}
        submitting={isCancelling}
        onClose={() => {
          if (!isCancelling) setSelected(null)
        }}
        onConfirm={cancelReservation}
      />
      <Modal open={Boolean(balanceReservation || resubmitReservation)} title={resubmitReservation ? 'Resubmit payment proof' : 'Submit balance payment proof'} onClose={() => { if (!balanceBusy) { setBalanceReservation(null); setResubmitReservation(null) } }}>
        {balanceReservation || resubmitReservation ? <form onSubmit={saveBalanceProof} className="space-y-4">
          <p className="text-sm text-muted">{resubmitReservation ? <>Corrected receipt for <strong className="text-text">{resubmitReservation.name}</strong>: <strong className="text-accent">{formatPHP(resubmitReservation.latestPaymentAmount ?? resubmitReservation.depositAmount)}</strong></> : <>Outstanding balance for <strong className="text-text">{balanceReservation.name}</strong>: <strong className="text-accent">{formatPHP(balanceReservation.balanceDue)}</strong></>}</p>
          {resubmitReservation ? <p className="text-xs text-muted">Payment method: <strong className="text-text">{resubmitReservation.paymentMethod}</strong></p> : <><label className="block text-xs font-medium text-muted">Transfer method<select value={balanceMethod} onChange={(event) => { setBalanceMethod(event.target.value); const first = data?.savedMethods?.find((method) => method.methodType === event.target.value); setBalanceSavedMethodId(first ? String(first.id) : '') }} className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text"><option>GCash</option><option>Maya</option></select></label>
          {data?.savedMethods?.some((method) => method.methodType === balanceMethod) ? <label className="block text-xs font-medium text-muted">Saved account<select value={balanceSavedMethodId} onChange={(event) => setBalanceSavedMethodId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">{data.savedMethods.filter((method) => method.methodType === balanceMethod).map((method) => <option key={method.id} value={method.id}>{method.accountName} · {method.mobileMasked}{method.isDefault ? ' · Default' : ''}</option>)}</select></label> : null}</>}
          <label className="block text-xs font-medium text-muted">Transfer receipt / proof<input type="file" required accept="image/png,image/jpeg,image/webp" disabled={balanceBusy || preparingBalanceProof} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { setBalanceError('Choose an image receipt.'); return } setPreparingBalanceProof(true); setBalanceError(''); try { const dataUrl = await compressReceipt(file); setBalanceProof({ data: dataUrl, name: file.name }) } catch (proofError) { setBalanceError(proofError.message || 'Receipt image could not be prepared.') } finally { setPreparingBalanceProof(false) } }} className="mt-1 block w-full rounded-md border border-border bg-bg p-2 text-xs text-text file:mr-3 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:font-semibold" />{balanceProof ? <span className="mt-1 block text-xs text-success">Ready: {balanceProof.name}</span> : null}</label>
          <label className="block text-xs font-medium text-muted">Transaction reference (optional)<input value={balanceReference} maxLength={100} onChange={(event) => setBalanceReference(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" /></label>
          <p className="text-xs leading-5 text-muted">This is a manual transfer. Your account will remain unpaid until an administrator verifies the receipt.</p>
          {balanceError ? <p role="alert" className="text-sm text-danger">{balanceError}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={balanceBusy} onClick={() => { setBalanceReservation(null); setResubmitReservation(null) }}>Cancel</Button><Button type="submit" disabled={balanceBusy || preparingBalanceProof || !balanceProof}>{balanceBusy ? 'Submitting…' : resubmitReservation ? 'Resubmit proof for verification' : `Submit ${formatPHP(balanceReservation.balanceDue)} for verification`}</Button></div>
        </form> : null}
      </Modal>
    </div>
  )
}

function isBeforeReservationStart(reservation) {
  const date = String(reservation.date ?? '')
  const time = String(reservation.startTime ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false
  return new Date(`${date}T${time}:00`).getTime() > Date.now()
}

export default ReservedSchedulePage

async function compressReceipt(file) {
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
  while (dataUrl.length > 680000 && quality > 0.4) { quality -= 0.1; dataUrl = canvas.toDataURL('image/jpeg', quality) }
  if (dataUrl.length > 680000) throw new Error('Receipt image is too large. Choose a smaller photo.')
  return dataUrl
}
