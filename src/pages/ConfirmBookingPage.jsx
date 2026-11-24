import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import useAsyncResource from '../hooks/useAsyncResource'
import { facilityService } from '../services/facilityService'
import { paymentService } from '../services/paymentService'
import { promoService } from '../services/promoService'
import { reservationService } from '../services/reservationService'
import { settingsService } from '../services/settingsService'
import { formatTimeRange } from '../utils/bookingTime'
import { calculateCheckoutAmounts } from '../utils/bookingPayment'
import { calculateBookingFees, formatPHP } from '../utils/fees'
import { bookedEquipmentHours, selectedEquipmentLines } from '../utils/equipmentRental'

const STEPS = ['Payment option', 'Payment method', 'Balance', 'Review']

function ConfirmBookingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const cardPaymentReturn = searchParams.get('cardPayment') === 'return'
  const returnReservationId = Number(searchParams.get('reservationId'))
  const returnResult = searchParams.get('result')
  const [step, setStep] = useState(0)
  const [paymentOption, setPaymentOption] = useState('full')
  const [paymentMethod, setPaymentMethod] = useState('GCash')
  const [methodSelectionMade, setMethodSelectionMade] = useState(false)
  const [savedMethodId, setSavedMethodId] = useState('')
  const [addAnother, setAddAnother] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [saveMethod, setSaveMethod] = useState(false)
  const [balanceSettlement, setBalanceSettlement] = useState('')
  const [paymentProof, setPaymentProof] = useState(null)
  const [paymentReference, setPaymentReference] = useState('')
  const [promoCodeInput, setPromoCodeInput] = useState('')
  const [appliedPromo, setAppliedPromo] = useState(null)
  const [promoEntryOpen, setPromoEntryOpen] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [isApplyingPromo, setIsApplyingPromo] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [conflictDetected, setConflictDetected] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparingProof, setIsPreparingProof] = useState(false)
  const [isSavingDefault, setIsSavingDefault] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [confirmedReservation, setConfirmedReservation] = useState(null)
  const [cardReturnStatus, setCardReturnStatus] = useState(null)
  const [isResumingCard, setIsResumingCard] = useState(false)
  const submitLock = useRef(false)

  const loader = useCallback(async () => {
    const [draft, settings, savedMethods] = await Promise.all([
      reservationService.getBookingDraft(),
      settingsService.getSettings(),
      paymentService.getSavedPaymentMethods(),
    ])
    if (!draft?.facilityId || !draft?.date) {
      throw new Error('Your saved booking selection is missing or expired. Return to Sports Facilities and choose a schedule again.')
    }
    const [facility, reservations] = await Promise.all([
      facilityService.getFacilityById(draft.facilityId),
      draft.rescheduleId ? reservationService.getReservedSchedule() : Promise.resolve([]),
    ])
    if (!facility) throw new Error('The selected facility could not be found.')
    const fallbackRate = Number(String(facility.price).replace(/[^\d.]/g, ''))
    const courtCharges = Number(draft.courtRate ?? fallbackRate * Number(draft.duration) * Number(draft.quantity ?? 1))
    const equipmentById = new Map((facility.equipmentCategories ?? []).flatMap((category) => (category.items ?? []).map((item) => [Number(item.id), item])))
    const equipmentSelectionChanged = (draft.equipmentItems ?? []).some((selection) => {
      const item = equipmentById.get(Number(selection.itemId))
      return !item || Number(selection.quantity) > Number(item.stockQuantity)
    })
    if (equipmentSelectionChanged) {
      throw new Error('An equipment item or its stock changed. Return to the schedule and review your rentals.')
    }
    const equipmentLines = selectedEquipmentLines(facility.equipmentCategories ?? [], draft.equipmentItems ?? [], draft.courtBookings ?? [])
    if (equipmentLines.length !== (draft.equipmentItems ?? []).filter((item) => Number(item.quantity) > 0).length) {
      throw new Error('A selected equipment item is no longer available. Return to the schedule and update your rentals.')
    }
    const equipmentTotal = equipmentLines.reduce((sum, line) => sum + line.lineTotal, 0)
    const equipmentHours = bookedEquipmentHours(draft.courtBookings ?? [])
    const rentalTotal = courtCharges + equipmentTotal
    const fees = calculateBookingFees(rentalTotal, settings.fees)
    return {
      draft: { ...draft, courtRate: rentalTotal, courtCharges, equipmentTotal, equipmentHours, equipmentLines },
      facility,
      settings,
      fees,
      savedMethods,
      reservation: reservations.find((item) => Number(item.id) === Number(draft.rescheduleId)) ?? null,
    }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)

  useEffect(() => {
    if (!cardPaymentReturn) return undefined
    if (!Number.isInteger(returnReservationId) || returnReservationId < 1) {
      setCardReturnStatus({ loading: false, error: 'The card payment return did not include a valid reservation.' })
      return undefined
    }
    let active = true
    let timer
    let attempts = 0
    setCardReturnStatus({ loading: true })
    const checkStatus = async () => {
      attempts += 1
      try {
        const result = await paymentService.getCardPaymentStatus(returnReservationId)
        if (!active) return
        setCardReturnStatus({ ...result, loading: false, result: returnResult })
        if (result.paid || attempts >= 6) return
      } catch (statusError) {
        if (!active) return
        setCardReturnStatus({ loading: false, error: statusError.message || 'Payment status could not be checked.', result: returnResult })
        return
      }
      timer = window.setTimeout(checkStatus, 2000)
    }
    void checkStatus()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [cardPaymentReturn, returnReservationId, returnResult])

  const bookingFees = appliedPromo?.fees ?? data?.fees
  const checkout = data ? calculateCheckoutAmounts(bookingFees, paymentOption) : null
  const preferredMethod = data?.savedMethods?.find((method) => method.isDefault) ?? data?.savedMethods?.[0]
  const activePaymentMethod = methodSelectionMade ? paymentMethod : preferredMethod?.methodType ?? paymentMethod
  const matchingMethods = data?.savedMethods?.filter((method) => method.methodType === activePaymentMethod) ?? []
  const chosenSavedMethod = matchingMethods.find((method) => String(method.id) === String(savedMethodId))
    ?? (!savedMethodId && !addAnother ? matchingMethods.find((method) => method.isDefault) ?? matchingMethods[0] : null)
  const enteringNewMethod = activePaymentMethod !== 'Card' && (!chosenSavedMethod || addAnother)
  const visibleSteps = paymentOption === 'half' ? STEPS : STEPS.filter((_, index) => index !== 2)
  const visibleStep = paymentOption === 'half' || step < 2 ? step : step - 1

  const courtScheduleRows = !data
    ? []
    : data.draft?.courtBookings?.length
    ? data.draft.courtBookings.map((booking, index) => {
      const dateLabel = new Date(`${data.draft.date}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
      const rate = Number(booking.hourlyRate ?? data.draft.hourlyRate ?? String(data.facility.price).replace(/[^\d.]/g, ''))
      const duration = Number(booking.duration)
      return {
        label: `Court ${booking.courtNumber ?? index + 1} · ${dateLabel}`,
        value: `${formatTimeRange(booking.startTime, duration).label} · ${formatPHP(rate * duration)}`,
      }
    })
    : [{
      label: new Date(`${data?.draft?.date}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }),
      value: formatTimeRange(data?.draft?.time, data?.draft?.duration).label,
    }]

  function selectMethod(method) {
    setPaymentMethod(method)
    setMethodSelectionMade(true)
    const preferred = data?.savedMethods?.find((item) => item.methodType === method && item.isDefault)
      ?? data?.savedMethods?.find((item) => item.methodType === method)
    setSavedMethodId(preferred ? String(preferred.id) : '')
    setAddAnother(false)
    setErrorMessage('')
  }

  async function applyPromoCode() {
    const code = promoCodeInput.trim().toUpperCase()
    if (!code || !data || isApplyingPromo) {
      setPromoError('Enter a promo code first.')
      return
    }
    setIsApplyingPromo(true)
    setPromoError('')
    try {
      const result = await promoService.validatePromoCode(code, data.fees.courtRate)
      setAppliedPromo({ ...result.promo, fees: result.fees })
      setPromoCodeInput(result.promo.code)
      setPromoEntryOpen(false)
    } catch (applyError) {
      setPromoError(applyError.message || 'This promo code could not be applied.')
    } finally {
      setIsApplyingPromo(false)
    }
  }

  function removePromoCode() {
    setAppliedPromo(null)
    setPromoCodeInput('')
    setPromoEntryOpen(false)
    setPromoError('')
  }

  async function setSelectedMethodDefault() {
    if (!chosenSavedMethod || chosenSavedMethod.isDefault || isSavingDefault) return
    setIsSavingDefault(true)
    setErrorMessage('')
    try {
      await paymentService.setDefaultPaymentMethod(chosenSavedMethod.id)
      await reload()
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : 'The default payment method could not be saved.')
    } finally {
      setIsSavingDefault(false)
    }
  }

  function validateStep() {
    if (step === 0) return true
    if (step === 1) {
      if (promoEntryOpen && promoCodeInput.trim() && promoCodeInput.trim().toUpperCase() !== appliedPromo?.code) {
        setErrorMessage('Apply the entered promo code or clear it before continuing.')
        return false
      }
      if (activePaymentMethod === 'Card') return true
      if (!['GCash', 'Maya'].includes(activePaymentMethod)) {
        setErrorMessage('Choose GCash, Maya, or debit/credit card.')
        return false
      }
      if (!enteringNewMethod && !chosenSavedMethod) {
        setErrorMessage('Choose a saved payment account or add another account.')
        return false
      }
      if (enteringNewMethod && (!accountName.trim() || !/^((\+?63|0)9)\d{9}$/.test(mobileNumber.replace(/[\s()-]/g, '')))) {
        setErrorMessage('Enter the account holder name and a valid Philippine mobile number.')
        return false
      }
      if (!paymentProof) {
        setErrorMessage('Upload a transfer receipt or proof. The payment remains pending until it is verified.')
        return false
      }
      return true
    }
    if (step === 2 && paymentOption === 'half' && !['cash-checkin', 'online-checkin'].includes(balanceSettlement)) {
      setErrorMessage('Choose how to settle the remaining balance.')
      return false
    }
    return true
  }

  function continueCheckout() {
    setErrorMessage('')
    if (!validateStep()) return
    setStep((current) => current === 1 && paymentOption === 'full' ? 3 : Math.min(3, current + 1))
  }

  function previousStep() {
    setErrorMessage('')
    setStep((current) => current === 3 && paymentOption === 'full' ? 1 : Math.max(0, current - 1))
  }

  async function preparePaymentProof(file) {
    setErrorMessage('')
    if (!file) {
      setPaymentProof(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Upload a photo of the receipt or transfer confirmation.')
      return
    }
    setIsPreparingProof(true)
    try {
      setPaymentProof({ data: await compressReceipt(file), name: file.name })
    } catch (proofError) {
      setPaymentProof(null)
      setErrorMessage(proofError.message || 'The receipt image could not be prepared.')
    } finally {
      setIsPreparingProof(false)
    }
  }

  async function confirm() {
    if (submitLock.current || !data || !checkout) return
    setErrorMessage('')
    setConflictDetected(false)
    setSubmissionUncertain(false)
    if (data.draft.rescheduleId) {
      submitLock.current = true
      setIsSubmitting(true)
      try {
        await reservationService.validateBookingAvailability(data.draft)
        const result = await reservationService.rescheduleReservation({
          reservationId: Number(data.draft.rescheduleId),
          date: data.draft.date,
          time: data.draft.time,
          endTime: data.draft.endTime,
          courtBookings: data.draft.courtBookings,
        })
        setConfirmedReservation({ ...data.reservation, ...result, id: Number(result.id), name: data.facility.name, status: data.reservation?.status ?? 'Pending', rescheduled: true })
      } catch (submitError) {
        setConflictDetected(Number(submitError?.status) === 409)
        setErrorMessage(submitError instanceof Error ? submitError.message : 'Schedule could not be updated.')
      } finally {
        submitLock.current = false
        setIsSubmitting(false)
      }
      return
    }
    if (!paymentProof && activePaymentMethod !== 'Card') {
      setErrorMessage('Upload payment proof before submitting this reservation.')
      setStep(1)
      return
    }
    submitLock.current = true
    setIsSubmitting(true)
    try {
      let selectedSavedMethodId = chosenSavedMethod ? Number(chosenSavedMethod.id) : null
      if (activePaymentMethod !== 'Card' && enteringNewMethod && saveMethod) {
        const saved = await paymentService.savePaymentMethod({
          methodType: activePaymentMethod,
          accountName: accountName.trim(),
          mobileNumber,
          isDefault: matchingMethods.length === 0,
        })
        selectedSavedMethodId = Number(saved.id)
      }
      const bookingPayload = {
        ...data.draft,
        facilityName: data.facility.name,
        paymentMethod: activePaymentMethod,
        paymentOption,
        balanceSettlement: paymentOption === 'half' ? balanceSettlement : '',
        savedPaymentMethodId: selectedSavedMethodId,
        paymentAccountName: enteringNewMethod ? accountName.trim() : '',
        paymentMobile: enteringNewMethod ? mobileNumber : '',
        userTotal: bookingFees.userTotal,
        promoCode: appliedPromo?.code ?? '',
        amountToPayNow: checkout.amountToPayNow,
        paymentProof: paymentProof?.data ?? null,
        paymentReference: paymentReference.trim(),
      }
      await reservationService.validateBookingAvailability(bookingPayload)
      const reservation = await reservationService.createReservation(bookingPayload)
      if (activePaymentMethod === 'Card') {
        const cardCheckout = await paymentService.createCardCheckout(reservation.id)
        if (cardCheckout.paid) {
          const status = await paymentService.getCardPaymentStatus(reservation.id)
          setConfirmedReservation({ ...reservation, status: status.reservationStatus, paymentStatus: status.paymentStatus })
        }
        else window.location.assign(cardCheckout.checkoutUrl)
      } else {
        setConfirmedReservation(reservation)
      }
    } catch (submitError) {
      if (submitError?.code === 'RESERVATION_STATUS_UNKNOWN') setSubmissionUncertain(true)
      const conflict = Number(submitError?.status) === 409
      setConflictDetected(conflict)
      setErrorMessage(submitError instanceof Error
        ? submitError.message
        : conflict ? 'The selected schedule or equipment is no longer available. Review the updated options and try again.' : 'Reservation could not be submitted.')
    } finally {
      submitLock.current = false
      setIsSubmitting(false)
    }
  }

  async function checkReservationStatus() {
    if (isCheckingStatus) return
    setIsCheckingStatus(true)
    setErrorMessage('')
    try {
      const draft = data?.draft?.requestId ? data.draft : await reservationService.getBookingDraft()
      if (!draft?.requestId) throw new Error('No reservation request ID is available. Check Reservation History before retrying.')
      const reservation = await reservationService.findReservationByRequestId(draft.requestId)
      if (reservation) {
        setConfirmedReservation(reservation)
        setSubmissionUncertain(false)
        return
      }
      setSubmissionUncertain(false)
      setErrorMessage('No saved reservation was found. You can retry; the same request ID prevents a duplicate.')
    } catch {
      setSubmissionUncertain(true)
      setErrorMessage('The reservation status is still unconfirmed. Check Reservation History before retrying.')
    } finally {
      setIsCheckingStatus(false)
    }
  }

  async function resumeCardPayment() {
    if (!Number.isInteger(returnReservationId) || returnReservationId < 1 || isResumingCard) return
    setIsResumingCard(true)
    setErrorMessage('')
    try {
      const checkout = await paymentService.createCardCheckout(returnReservationId)
      if (checkout.paid) setCardReturnStatus({ paid: true, paymentStatus: 'paid', reservationStatus: 'Pending' })
      else window.location.assign(checkout.checkoutUrl)
    } catch (resumeError) {
      setErrorMessage(resumeError.message || 'The secure card checkout could not be reopened.')
    } finally {
      setIsResumingCard(false)
    }
  }

  const scheduleUrl = data ? `/choose-schedule?facility=${data.draft.facilityId}&date=${data.draft.date}&quantity=${data.draft.quantity ?? 1}&time=${data.draft.time ?? ''}&hours=${data.draft.duration ?? 1}${data.draft.rescheduleId ? `&reschedule=${data.draft.rescheduleId}` : ''}` : '/sports-facilities'

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeading title={data?.draft?.rescheduleId ? 'Review Schedule Change' : 'Confirm Booking'} description={data?.draft?.rescheduleId ? 'Review the new schedule before saving.' : 'Complete secure checkout to submit your reservation.'} />
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {error && !isLoading ? <Link to="/sports-facilities" className="inline-flex rounded-md border border-border px-3 py-2 text-sm font-semibold text-text hover:bg-surface">Back to Sports Facilities</Link> : null}
      {confirmedReservation ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{confirmedReservation.rescheduled ? 'Reservation Updated!' : 'Reservation Successful!'}</h2>
            <Badge tone={confirmedReservation.status === 'Pending' ? 'pending' : 'success'}>{confirmedReservation.status}</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">
            {confirmedReservation.rescheduled
              ? 'Your reservation time has been updated. The facility and customer have been notified.'
              : `Your reservation has been submitted and is now waiting for confirmation. ${confirmedReservation.paymentStatus === 'paid' ? 'Your initial payment is verified; the facility still needs to confirm the booking.' : confirmedReservation.paymentStatus === 'failed' ? 'Your payment proof needs correction before the booking can be confirmed.' : 'Your payment proof is pending manual verification.'}`}
          </p>
          <div className="mt-4 rounded-md border border-border bg-bg px-3 py-3 text-sm">
            <p className="font-semibold text-text">{confirmedReservation.name}</p>
            {confirmedReservation.courtSchedules?.length ? <div className="mt-2 space-y-1 border-t border-border pt-2">{confirmedReservation.courtSchedules.map((court, index) => <p key={court.courtId ?? index} className="text-xs text-muted">Court {court.courtNumber ?? index + 1}: {confirmedReservation.date} · {formatTimeRange(court.startTime, court.duration).label}</p>)}</div> : null}
            <p className="mt-1 text-xs text-muted">{confirmedReservation.date} · {confirmedReservation.time}</p>
            <p className="mt-2 text-xs text-muted">Reservation ID: {confirmedReservation.id}</p>
            {!confirmedReservation.rescheduled ? <p className="mt-2 text-xs text-muted">Submitted payment: {formatPHP(confirmedReservation.initialPaymentAmount ?? confirmedReservation.depositAmount ?? checkout?.amountToPayNow ?? 0)} · {confirmedReservation.paymentStatus === 'paid' ? 'Verified' : confirmedReservation.paymentStatus === 'failed' ? 'Needs correction' : 'Pending verification'}</p> : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Link to="/reservation-history" className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110">Reservation History</Link>
            <Link to="/dashboard" className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-text transition-colors hover:brightness-110">Dashboard</Link>
          </div>
        </Card>
      ) : cardPaymentReturn ? (
        <Card>
          <h2 className="text-lg font-bold">Card payment status</h2>
          {cardReturnStatus?.loading ? <p role="status" className="mt-3 text-sm text-muted">Checking PayMongo’s confirmation…</p> : cardReturnStatus?.paid ? <><p className="mt-3 text-sm leading-6 text-success">Card payment received. Your reservation is waiting for the facility to confirm it.</p><p className="mt-2 text-xs text-muted">Reservation #{returnReservationId} · Status: {cardReturnStatus.reservationStatus}</p></> : <><p className="mt-3 text-sm leading-6 text-muted">{cardReturnStatus?.error ?? (cardReturnStatus?.result === 'cancelled' ? 'Checkout was closed before payment was confirmed. You can resume it below.' : 'PayMongo has not confirmed this payment yet. If you completed checkout, wait briefly and check Reservation History before retrying.')}</p>{cardReturnStatus?.error ? <p role="alert" className="mt-2 text-xs text-danger">{cardReturnStatus.error}</p> : null}<Button className="mt-4" disabled={isResumingCard} onClick={resumeCardPayment}>{isResumingCard ? 'Opening secure checkout…' : 'Resume card payment'}</Button></>}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4"><Link to="/reservation-history" className="inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white">Reservation History</Link><Link to="/dashboard" className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-semibold">Dashboard</Link></div>
        </Card>
      ) : data?.draft?.rescheduleId ? (
        <Card>
          <h2 className="text-sm font-bold">{data.facility.name}</h2>
          <p className="mt-2 text-sm text-muted">{data.draft.date} · {courtScheduleRows.map((row) => `${row.label}: ${row.value}`).join(' · ')}</p>
          {errorMessage ? <p role="alert" className="mt-3 text-sm text-danger">{errorMessage}</p> : null}
          <div className="mt-5 flex justify-between border-t border-border pt-4"><Link to={scheduleUrl} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-semibold">Back</Link><Button disabled={isSubmitting} onClick={confirm}>{isSubmitting ? 'Saving…' : 'Confirm new schedule'}</Button></div>
        </Card>
      ) : data ? (
        <Modal open title="Booking checkout" onClose={() => { if (!isSubmitting) navigate(scheduleUrl) }} className="max-w-2xl" >
          <div className="space-y-5">
            <div aria-label="Checkout progress" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {visibleSteps.map((label, index) => <div key={label} className={`border-b-2 pb-2 text-center text-[11px] font-semibold ${index <= visibleStep ? 'border-accent text-text' : 'border-border text-muted'}`}><span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface">{index + 1}</span>{label}</div>)}
            </div>

            {step === 0 ? <section className="space-y-4"><div><h3 className="text-lg font-bold">Choose payment option</h3><p className="mt-1 text-xs text-muted">Select how much rental cost to pay now. The service fee is collected with this first payment.</p></div><div className="grid gap-3 sm:grid-cols-2">
              <PaymentChoice selected={paymentOption === 'full'} title="Pay Full" detail="Pay the full booking total now" amount={checkout.total} onClick={() => { setPaymentOption('full'); setBalanceSettlement(''); setErrorMessage('') }} />
              <PaymentChoice selected={paymentOption === 'half'} title="Pay Half" detail="50% downpayment + full service fee" amount={checkout.amountToPayNow} onClick={() => { setPaymentOption('half'); setErrorMessage('') }} />
            </div><div className="rounded-md border border-border bg-bg p-3 text-xs text-muted">
              <div className="flex justify-between"><span>Court charges</span><span>{formatPHP(data.draft.courtCharges)}</span></div>
              {data.draft.equipmentLines.length ? <><div className="mt-1 flex justify-between"><span>Equipment rentals</span><span>{formatPHP(data.draft.equipmentTotal)}</span></div>{data.draft.equipmentLines.map((line) => <div key={line.itemId} className="mt-1 flex justify-between text-muted"><span>{line.itemName} × {line.quantity}{line.billingUnit === 'hour' ? ` × ${line.billedHours} hr` : ''}</span><span>{formatPHP(line.lineTotal)}</span></div>)}</> : null}
              <div className="mt-1 flex justify-between"><span>Total rental charges</span><span>{formatPHP(appliedPromo ? bookingFees.originalCourtRate : bookingFees.courtRate)}</span></div>
              {appliedPromo && bookingFees.promoRentalDiscount > 0 ? <div className="mt-1 flex justify-between text-success"><span>Promo rental discount</span><span>−{formatPHP(bookingFees.promoRentalDiscount)}</span></div> : null}<div className="mt-1 flex justify-between"><span>Platform service fee</span><span>{formatPHP(appliedPromo ? data.fees.serviceFee : bookingFees.serviceFee)}</span></div>{appliedPromo && bookingFees.promoServiceFeeDiscount > 0 ? <div className="mt-1 flex justify-between text-success"><span>Promo service fee discount</span><span>−{formatPHP(bookingFees.promoServiceFeeDiscount)}</span></div> : null}<div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold text-text"><span>Total</span><span>{formatPHP(checkout.total)}</span></div><div className="mt-1 flex justify-between text-accent"><span>Pay now</span><span>{formatPHP(checkout.amountToPayNow)}</span></div>{paymentOption === 'half' ? <div className="mt-1 flex justify-between"><span>Remaining rental balance</span><span>{formatPHP(checkout.remainingBalance)}</span></div> : null}</div></section> : null}

          {step === 1 ? <section className="space-y-4"><div><h3 className="text-lg font-bold">Choose payment method</h3><p className="mt-1 text-xs text-muted">Pay {formatPHP(checkout.amountToPayNow)} now. {activePaymentMethod === 'Card' ? 'You will complete payment on PayMongo’s secure hosted checkout.' : 'Transfer proof is reviewed manually before payment is marked paid.'}</p></div>
              <div className="rounded-md border border-border bg-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold">Promo Code</p><p className="mt-1 text-xs text-muted">Enter a code from RESERVA to check your discount.</p></div>
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => {
                    if (promoEntryOpen) {
                      setPromoCodeInput(appliedPromo?.code ?? '')
                      setPromoEntryOpen(false)
                    } else {
                      setPromoError('')
                      setPromoEntryOpen(true)
                    }
                  }}>{promoEntryOpen ? 'Cancel' : appliedPromo ? 'Change code' : 'Use Code'}</Button>
                </div>
                {promoEntryOpen ? <div className="mt-3 grid items-end gap-2 sm:grid-cols-[1fr_auto]">
                  <Input label="Enter promo code" value={promoCodeInput} onChange={(event) => { setPromoCodeInput(event.target.value.toUpperCase()); setPromoError('') }} placeholder="Promo code" maxLength={32} autoCapitalize="characters" />
                  <Button type="button" disabled={isApplyingPromo || !promoCodeInput.trim()} onClick={applyPromoCode}>{isApplyingPromo ? 'Checking…' : 'Apply code'}</Button>
                </div> : null}
                {promoError ? <p role="alert" className="mt-2 text-xs text-danger">{promoError}</p> : null}
                {appliedPromo ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/30 bg-success/5 p-2.5 text-xs">
                  <p><span className="font-semibold text-success">{appliedPromo.code} applied</span><span className="ml-2 text-muted">{appliedPromo.discountType === 'percent' ? `${appliedPromo.value}% off rental` : appliedPromo.discountType === 'fixed' ? `${formatPHP(appliedPromo.value)} off rental` : 'Platform service fee waived'} · You save {formatPHP(appliedPromo.discountAmount)}</span></p>
                  <button type="button" className="font-semibold text-muted underline" onClick={removePromoCode}>Remove</button>
                </div> : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
              {['GCash', 'Maya'].map((method) => <button key={method} type="button" onClick={() => selectMethod(method)} className={`rounded-md border p-3 text-left text-sm font-bold ${activePaymentMethod === method ? 'border-accent bg-accent/10 text-text' : 'border-border bg-bg text-muted'}`}>{method}<span className="mt-1 block text-[10px] font-normal">Manual transfer + receipt</span></button>)}
              <button type="button" onClick={() => selectMethod('Card')} className={`rounded-md border p-3 text-left text-sm font-bold ${activePaymentMethod === 'Card' ? 'border-accent bg-accent/10 text-text' : 'border-border bg-bg text-muted'}`}>Debit / Credit card<span className="mt-1 block text-[10px] font-normal">Secure PayMongo checkout</span></button>
            </div>
              {matchingMethods.length ? <div className="space-y-2"><p className="text-xs font-semibold text-muted">Saved {activePaymentMethod} accounts</p>{matchingMethods.map((method) => <label key={method.id} className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${String(method.id) === String(chosenSavedMethod?.id) && !addAnother ? 'border-accent bg-accent/5' : 'border-border bg-bg'}`}><input type="radio" name="saved-payment-method" checked={String(method.id) === String(chosenSavedMethod?.id) && !addAnother} onChange={() => { setSavedMethodId(String(method.id)); setAddAnother(false); setErrorMessage('') }} /><span className="min-w-0 flex-1"><span className="block font-semibold text-text">{method.accountName} · {method.mobileMasked}</span><span className="text-[10px] text-muted">{method.isDefault ? 'Default account' : 'Saved account'}</span></span>{method.isDefault ? <Badge tone="success">Default</Badge> : null}</label>)}{chosenSavedMethod && !chosenSavedMethod.isDefault ? <button type="button" disabled={isSavingDefault} className="text-xs font-semibold text-accent underline disabled:opacity-50" onClick={setSelectedMethodDefault}>{isSavingDefault ? 'Saving default…' : 'Set selected account as default'}</button> : null}<button type="button" className="ml-3 text-xs font-semibold text-accent underline" onClick={() => { setSavedMethodId(''); setAddAnother(true); setErrorMessage('') }}>+ Add another payment method</button></div> : null}
              {enteringNewMethod ? <div className="grid gap-3 rounded-md border border-border bg-bg p-3 sm:grid-cols-2"><label className="block text-xs text-muted">Account name<input autoComplete="name" maxLength={150} value={accountName} onChange={(event) => setAccountName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text" placeholder="Name registered to account" /></label><label className="block text-xs text-muted">Mobile number<input autoComplete="tel" inputMode="tel" maxLength={20} value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text" placeholder="09XXXXXXXXX" /></label><label className="flex items-center gap-2 text-xs text-muted sm:col-span-2"><input type="checkbox" checked={saveMethod} onChange={(event) => setSaveMethod(event.target.checked)} />Save this e-wallet account for future bookings (encrypted)</label></div> : null}
              {activePaymentMethod === 'Card' ? <p className="rounded-md border border-border bg-bg p-3 text-xs leading-5 text-muted">PayMongo collects card details on its hosted checkout. RESERVA never stores your card number, expiry, security code, or 3-D Secure details.</p> : <p className="rounded-md border border-border bg-bg p-3 text-xs leading-5 text-muted">Before transferring, confirm the facility’s GCash or Maya recipient details directly with the facility. RESERVA does not process the transfer. Upload the receipt below for manual review; never share your PIN, password, or OTP.</p>}
              <div className={activePaymentMethod === 'Card' ? 'hidden' : 'grid gap-3 sm:grid-cols-2'}><label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Transfer receipt / proof (required)</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={isSubmitting || isPreparingProof} onChange={(event) => preparePaymentProof(event.target.files?.[0])} className="block w-full rounded-md border border-border bg-bg p-2 text-xs text-text file:mr-3 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:font-semibold file:text-text" />{isPreparingProof ? <span className="mt-1 block text-xs text-muted">Preparing receipt…</span> : paymentProof ? <span className="mt-1 block text-xs text-success">Ready: {paymentProof.name}</span> : null}</label><label className="block"><span className="mb-1.5 block text-xs font-medium text-muted">Transaction reference (optional)</span><input value={paymentReference} maxLength={100} onChange={(event) => setPaymentReference(event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" placeholder="Reference number" /></label></div>
            </section> : null}

            {step === 2 && paymentOption === 'half' ? <section className="space-y-4"><div><h3 className="text-lg font-bold">Settle the remaining balance</h3><p className="mt-1 text-xs text-muted">Remaining balance: <strong className="text-accent">{formatPHP(checkout.remainingBalance)}</strong></p></div><div className="grid gap-3 sm:grid-cols-2"><PaymentChoice selected={balanceSettlement === 'cash-checkin'} title="Cash on check-in" detail="Pay the remaining rental balance directly at the facility" onClick={() => setBalanceSettlement('cash-checkin')} /><PaymentChoice selected={balanceSettlement === 'online-checkin'} title="Online on check-in" detail="Submit an online transfer receipt for manual verification before or on check-in" onClick={() => setBalanceSettlement('online-checkin')} /></div><p className="rounded-md border border-border bg-bg p-3 text-xs leading-5 text-muted">Online balance payments use manual transfer proof until a secure payment gateway is configured. The facility must record cash paid at check-in.</p></section> : null}

            {step === 3 ? <section className="space-y-4"><div><h3 className="text-lg font-bold">Review and pay</h3><p className="mt-1 text-xs text-muted">Check each court schedule and the payment amount before submitting.</p></div><div className="divide-y divide-border rounded-md border border-border bg-bg px-3">
              <SummaryRow label="Facility" value={data.facility.name} /><SummaryRow label="Reservation date" value={new Date(`${data.draft.date}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })} />
              {courtScheduleRows.map((row) => <SummaryRow key={row.label} label={row.label} value={row.value} />)}
              <SummaryRow label="Court charges" value={formatPHP(data.draft.courtCharges)} />
              {data.draft.equipmentLines.length ? <>
                <SummaryRow label="Equipment rentals" value={formatPHP(data.draft.equipmentTotal)} />
                {data.draft.equipmentLines.map((line) => <SummaryRow key={line.itemId} label={`${line.categoryName} · ${line.itemName} × ${line.quantity}${line.billingUnit === 'hour' ? ` · ${line.billedHours} hr` : ''}`} value={formatPHP(line.lineTotal)} />)}
              </> : null}
              <SummaryRow label="Total rental charges" value={formatPHP(appliedPromo ? bookingFees.originalCourtRate : bookingFees.courtRate)} />
              {appliedPromo && bookingFees.promoRentalDiscount > 0 ? <SummaryRow label="Promo rental discount" value={`−${formatPHP(bookingFees.promoRentalDiscount)}`} /> : null}
              <SummaryRow label="Platform service fee" value={formatPHP(appliedPromo ? data.fees.serviceFee : bookingFees.serviceFee)} />
              {appliedPromo && bookingFees.promoServiceFeeDiscount > 0 ? <SummaryRow label="Promo service fee discount" value={`−${formatPHP(bookingFees.promoServiceFeeDiscount)}`} /> : null}
              {appliedPromo ? <SummaryRow label="Promo code" value={`${appliedPromo.code} · Total savings ${formatPHP(appliedPromo.discountAmount)}`} /> : null}
              <SummaryRow label="Total booking cost" value={formatPHP(checkout.total)} /><SummaryRow label="Payment option" value={paymentOption === 'full' ? 'Pay Full' : 'Pay Half · 50% downpayment'} /><SummaryRow label="Payment method" value={activePaymentMethod === 'Card' ? 'Debit / Credit card · PayMongo' : `${activePaymentMethod}${chosenSavedMethod ? ` · ${chosenSavedMethod.accountName} (${chosenSavedMethod.mobileMasked})` : ` · ${accountName} (${mobileNumber})`}`} />
              <SummaryRow label="Amount payable now" value={formatPHP(checkout.amountToPayNow)} emphasis />
              <SummaryRow label="Remaining balance" value={formatPHP(checkout.remainingBalance)} />
              {paymentOption === 'half' ? <SummaryRow label="Balance settlement" value={balanceSettlement === 'cash-checkin' ? 'Cash on check-in' : 'Online payment on check-in (manual proof review)'} /> : null}
              <SummaryRow label={activePaymentMethod === 'Card' ? 'Card checkout' : 'Payment proof'} value={activePaymentMethod === 'Card' ? 'Secure PayMongo checkout' : paymentProof?.name ?? 'Missing'} />
            </div><div className="rounded-md border border-border p-3"><h4 className="text-xs font-bold">Cancellation and refund policy</h4><p className="mt-1 text-xs leading-5 text-muted">{data.settings.refundPolicy.freeCancelHours} or more hours before the reservation: eligible rental refund under the saved policy. Later cancellations use the {Math.round(data.settings.refundPolicy.lateCancelRefundRate * 100)}% rental refund rate; the service fee may be non-refundable. No-shows use the {Math.round(data.settings.refundPolicy.noShowRefundRate * 100)}% rental refund rate. The policy in effect at booking is saved with your reservation. Refunds are subject to review.</p></div><p className="text-xs text-muted">Your receipt is submitted as pending verification. The system will not mark a manual transfer as paid until an administrator verifies it.</p></section> : null}

            {errorMessage ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{errorMessage}</p>{conflictDetected ? <button type="button" className="font-semibold underline" onClick={() => navigate(scheduleUrl, { state: { bookingConflict: 'Another customer booked one of the selected courts.' } })}>Choose an alternative schedule</button> : null}{submissionUncertain ? <div className="flex flex-wrap items-center gap-3 text-xs"><Link to="/reservation-history" className="font-semibold underline">Check Reservation History</Link><Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={isCheckingStatus} onClick={checkReservationStatus}>{isCheckingStatus ? 'Checking status…' : 'Check status'}</Button></div> : null}</div> : null}

            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"><Button variant="secondary" disabled={isSubmitting || step === 0 || submissionUncertain} onClick={previousStep}>Back</Button>{step < 3 ? <Button disabled={isSubmitting || isPreparingProof || isApplyingPromo || submissionUncertain || (step === 1 && activePaymentMethod !== 'Card' && !paymentProof)} onClick={continueCheckout}>Continue</Button> : <Button disabled={isSubmitting || isApplyingPromo || submissionUncertain || isPreparingProof || (activePaymentMethod !== 'Card' && !paymentProof)} onClick={confirm}>{isSubmitting ? 'Submitting…' : `Confirm & Pay ${formatPHP(checkout.amountToPayNow)}`}</Button>}</div>
            {isSubmitting ? <p role="status" className="text-center text-xs text-muted">Submitting securely. Please keep this page open and do not submit again.</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function PaymentChoice({ selected, title, detail, amount, onClick }) {
  return <button type="button" onClick={onClick} className={`rounded-md border p-4 text-left transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:border-muted'}`}><span className="flex items-center justify-between gap-2 text-sm font-bold text-text">{title}<span className={`h-4 w-4 rounded-full border ${selected ? 'border-accent bg-accent ring-2 ring-accent/30' : 'border-muted'}`} /></span><span className="mt-2 block text-xs text-muted">{detail}</span>{amount !== undefined ? <span className="mt-3 block text-lg font-bold text-accent">{formatPHP(amount)}</span> : null}</button>
}

function SummaryRow({ label, value, emphasis = false }) {
  return <div className="flex flex-wrap justify-between gap-3 py-2.5 text-xs"><span className="text-muted">{label}</span><span className={`text-right ${emphasis ? 'font-bold text-accent' : 'font-semibold text-text'}`}>{value}</span></div>
}

export default ConfirmBookingPage

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
  while (dataUrl.length > 680000 && quality > 0.4) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > 680000) throw new Error('Receipt image is too large. Choose a smaller photo.')
  return dataUrl
}
