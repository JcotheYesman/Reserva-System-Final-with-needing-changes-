import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import TimeSlot from '../components/ui/TimeSlot'
import EquipmentRentalModal from '../components/facility/EquipmentRentalModal'
import useAsyncResource from '../hooks/useAsyncResource'
import { facilityService } from '../services/facilityService'
import { reservationService } from '../services/reservationService'
import { formatTimeRange, timeToMinutes } from '../utils/bookingTime'
import { formatPHP } from '../utils/fees'
import { calculateEquipmentTotal } from '../utils/equipmentRental'

function getBookingClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  }
}

function SchedulePage() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const facilityId = Number(searchParams.get('facility') || 1)
  const rescheduleId = Number(searchParams.get('reschedule') || 0)
  const initialQuantity = Math.max(1, Number(searchParams.get('quantity') || 1))
  const initialStart = searchParams.get('time') || ''
  const initialDuration = Number(searchParams.get('hours') || 0)
  const initialSlots = /^\d{2}:00$/.test(initialStart) && Number.isInteger(initialDuration) && initialDuration >= 1 && initialDuration <= 14 && timeToMinutes(initialStart) + initialDuration * 60 <= 22 * 60
    ? Array.from({ length: initialDuration }, (_, index) => `${String(Math.floor((timeToMinutes(initialStart) + index * 60) / 60)).padStart(2, '0')}:00`)
    : []
  const [now, setNow] = useState(() => new Date())
  const bookingClock = getBookingClock(now)
  const today = bookingClock.date
  const [date, setDate] = useState(() => {
    const requestedDate = searchParams.get('date')
    const currentDate = getBookingClock().date
    return requestedDate && requestedDate >= currentDate ? requestedDate : currentDate
  })
  const [quantity, setQuantity] = useState(String(initialQuantity))
  const durationHint = Math.max(0, Number(searchParams.get('hours') || 0))
  const [courtIds, setCourtIds] = useState([])
  const [courtStep, setCourtStep] = useState(0)
  const [courtSchedules, setCourtSchedules] = useState(() => Array.from({ length: initialQuantity }, () => [...initialSlots]))
  const [confirmedSteps, setConfirmedSteps] = useState([])
  const [submitError, setSubmitError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false)
  const [equipmentItems, setEquipmentItems] = useState([])
  const restoredEquipmentFacility = useRef(null)

  useEffect(() => {
    const syncClock = () => {
      const currentTime = new Date()
      const currentDate = getBookingClock(currentTime).date
      setNow(currentTime)
      setDate((value) => value < currentDate ? currentDate : value)
    }
    syncClock()
    const timer = window.setInterval(syncClock, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const loader = useCallback(async () => {
    const [facility, availability, reservations] = await Promise.all([
      facilityService.getFacilityById(facilityId),
      reservationService.getSchedule(facilityId, date, rescheduleId),
      rescheduleId ? reservationService.getReservedSchedule() : Promise.resolve([]),
    ])
    if (!facility) throw new Error('The selected facility could not be found.')
    const reservation = reservations.find((item) => Number(item.id) === rescheduleId)
    if (rescheduleId && !reservation) throw new Error('The reservation selected for rescheduling could not be found.')
    return { facility, availability, reservation }
  }, [facilityId, date, rescheduleId])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const courts = data?.availability.courts ?? []
  const maxCourts = data?.facility.courtCount ?? courts.length

  useEffect(() => {
    if (!data || restoredEquipmentFacility.current === String(facilityId)) return
    restoredEquipmentFacility.current = String(facilityId)
    reservationService.getBookingDraft().then((draft) => {
      if (Number(draft.facilityId) === Number(facilityId) && Array.isArray(draft.equipmentItems) && data.facility.equipmentRental) {
        const availableItems = new Map((data.facility.equipmentCategories ?? []).flatMap((category) => (category.items ?? []).map((item) => [Number(item.id), Number(item.stockQuantity)])))
        setEquipmentItems(draft.equipmentItems.flatMap((item) => {
          const id = Number(item.itemId)
          const stock = availableItems.get(id) ?? 0
          const quantity = Math.min(stock, Math.max(0, Number(item.quantity)))
          return quantity > 0 ? [{ itemId: id, quantity }] : []
        }))
      } else if (Number(draft.facilityId) === Number(facilityId)) {
        setEquipmentItems([])
      }
    }).catch(() => {})
  }, [data, facilityId])

  useEffect(() => {
    if (!data) return
    if (rescheduleId && data.reservation) {
      setQuantity(String(data.reservation.quantity))
      const assignedCourtIds = data.reservation.courtIds?.length
        ? data.reservation.courtIds
        : courts.slice(0, data.reservation.quantity).map((court) => court.courtId)
      setCourtIds(assignedCourtIds)
      const schedulesByCourt = new Map((data.reservation.courtSchedules ?? []).map((schedule) => [Number(schedule.courtId), schedule]))
      const legacyDuration = Math.max(1, Number(data.reservation.duration))
      const legacyStart = timeToMinutes(data.reservation.startTime)
      const legacySlots = Array.from({ length: legacyDuration }, (_, index) => `${String(Math.floor((legacyStart + index * 60) / 60)).padStart(2, '0')}:00`)
      setCourtSchedules(assignedCourtIds.map((courtId) => {
        const schedule = schedulesByCourt.get(Number(courtId))
        if (!schedule?.startTime || !schedule?.endTime) return [...legacySlots]
        const slots = Math.max(1, Math.round((timeToMinutes(schedule.endTime) - timeToMinutes(schedule.startTime)) / 60))
        return Array.from({ length: slots }, (_, index) => `${String(Math.floor((timeToMinutes(schedule.startTime) + index * 60) / 60)).padStart(2, '0')}:00`)
      }))
      setConfirmedSteps([])
      setCourtStep(0)
      return
    }
    setCourtSchedules((previous) => Array.from({ length: Number(quantity) }, (_, index) => previous[index] ?? []))
    setCourtIds((previous) => {
      const limit = Number(quantity)
      const retained = previous.filter((id) => courts.some((court) => Number(court.courtId) === Number(id))).slice(0, limit)
      const next = [...retained]
      for (const court of courts) {
        if (next.length >= limit) break
        if (!next.some((id) => Number(id) === Number(court.courtId))) next.push(court.courtId)
      }
      return next
    })
  }, [data, rescheduleId, quantity, courts])

  const activeCourtId = courtIds[courtStep]
  const activeCourt = courts.find((court) => Number(court.courtId) === Number(activeCourtId))
  const selectedSlots = courtSchedules[courtStep] ?? []
  const nowMinutes = bookingClock.minutes
  const isPastTime = (label) => date === today && timeToMinutes(label) <= nowMinutes
  const activeTimeRange = selectedSlots.length ? formatTimeRange(selectedSlots[0], selectedSlots.length) : null
  const courtBookings = courtSchedules.map((slots, index) => {
    const orderedSlots = [...slots].sort((left, right) => timeToMinutes(left) - timeToMinutes(right))
    const court = courts.find((entry) => Number(entry.courtId) === Number(courtIds[index]))
    const range = orderedSlots.length ? formatTimeRange(orderedSlots[0], orderedSlots.length) : null
    return {
      courtId: Number(courtIds[index]),
      courtNumber: Number(court?.courtNumber ?? index + 1),
      startTime: orderedSlots[0] ?? '',
      endTime: range?.endTime ?? '',
      duration: orderedSlots.length,
      selectedSlots: orderedSlots,
    }
  })
  const selectedCourtBookings = courtBookings.filter((booking) => booking.selectedSlots.length)
  const startTime = selectedCourtBookings.length
    ? selectedCourtBookings.reduce((earliest, booking) => timeToMinutes(booking.startTime) < timeToMinutes(earliest) ? booking.startTime : earliest, selectedCourtBookings[0].startTime)
    : ''
  const endTime = selectedCourtBookings.length
    ? selectedCourtBookings.reduce((latest, booking) => timeToMinutes(booking.endTime) > timeToMinutes(latest) ? booking.endTime : latest, selectedCourtBookings[0].endTime)
    : ''
  const duration = startTime && endTime ? (timeToMinutes(endTime) - timeToMinutes(startTime)) / 60 : 0
  const bookingSlots = courtBookings[0]?.selectedSlots ?? []
  const totalSelectedHours = selectedCourtBookings.reduce((total, booking) => total + booking.duration, 0)
  const hourlyRate = Number(data?.facility?.price?.replace(/[^\d.]/g, '') ?? 0)
  const courtRate = selectedCourtBookings.reduce((total, booking) => total + booking.duration * hourlyRate, 0)
  const equipmentTotal = calculateEquipmentTotal(data?.facility?.equipmentCategories ?? [], equipmentItems, selectedCourtBookings)
  const hasEquipmentRental = Boolean(data?.facility?.equipmentRental)
  const currentRangeAvailable = useMemo(() => {
    if (courtSchedules.length !== Number(quantity) || courtIds.length !== Number(quantity)) return false
    return courtIds.every((id, index) => {
      const slots = [...(courtSchedules[index] ?? [])].sort((left, right) => timeToMinutes(left) - timeToMinutes(right))
      if (!slots.length || slots.some((slot, slotIndex) => slotIndex > 0 && timeToMinutes(slot) !== timeToMinutes(slots[slotIndex - 1]) + 60)) return false
      const court = courts.find((entry) => Number(entry.courtId) === Number(id))
      return court && slots.every((label) => !isPastTime(label) && court.slots.some((slot) => slot.label === label && slot.status === 'available'))
    })
  }, [courtIds, quantity, courts, courtSchedules, date, today, nowMinutes])
  const activeRangeAvailable = Boolean(activeCourt && selectedSlots.length && selectedSlots.every((label) =>
    !isPastTime(label) && activeCourt.slots.some((slot) => slot.label === label && slot.status === 'available'),
  ))

  const alternatives = useMemo(() => {
    if (!courts.length) return []
    const requestedDuration = Math.max(1, rescheduleId ? Number(selectedSlots.length || data?.reservation?.duration) : selectedSlots.length || bookingSlots.length || durationHint)
    const results = []
    for (let hour = 8; hour + requestedDuration <= 22; hour += 1) {
      const labels = Array.from({ length: requestedDuration }, (_, index) => `${String(hour + index).padStart(2, '0')}:00`)
      const candidateCourts = rescheduleId ? courts.filter((court) => courtIds.some((id) => Number(id) === Number(court.courtId))) : courts
      const availableCourtIds = candidateCourts.filter((court) => labels.every((label) => !isPastTime(label) && court.slots.some((slot) => slot.label === label && slot.status === 'available'))).map((court) => court.courtId)
      if (availableCourtIds.length >= Number(quantity)) {
        results.push({ labels, courtIds: rescheduleId ? courtIds : availableCourtIds.slice(0, Number(quantity)) })
      }
    }
    return results.filter((item) => item.labels[0] !== startTime).slice(0, 4)
  }, [courts, selectedSlots.length, bookingSlots.length, quantity, startTime, rescheduleId, data, courtIds, durationHint, date, today, nowMinutes])

  function applySlots(labels) {
    setCourtSchedules((previous) => {
      const next = [...previous]
      next[courtStep] = labels
      return next
    })
    setConfirmedSteps((previous) => previous.filter((step) => step < courtStep))
    setSubmitError('')
  }

  function selectSlot(label, status) {
    if (!data?.facility.active || !data?.availability.active) return
    if (isPastTime(label)) {
      setCourtSchedules((previous) => {
        const next = [...previous]
        next[courtStep] = (next[courtStep] ?? []).filter((selected) => !isPastTime(selected))
        return next
      })
      setConfirmedSteps((previous) => previous.filter((step) => step !== courtStep))
      setSubmitError(`${formatTimeRange(label, 1).label} has already started or passed. Choose a time slot that starts later than the current time.`)
      return
    }
    if (status !== 'available') {
      setSubmitError(status === 'maintenance' ? 'This court is under maintenance during that hour.' : 'That court and hour are already reserved. Choose one of the available options below.')
      return
    }
    if (rescheduleId) {
      const fixedDuration = Math.max(1, selectedSlots.length || Number(data.reservation.duration))
      const start = timeToMinutes(label)
      if (start + fixedDuration * 60 > 22 * 60) {
        setSubmitError('That start time would extend beyond facility closing time.')
        return
      }
      const range = Array.from({ length: fixedDuration }, (_, index) => `${String(Math.floor((start + index * 60) / 60)).padStart(2, '0')}:00`)
      if (!activeCourt || !range.every((slotLabel) => activeCourt.slots.some((slot) => slot.label === slotLabel && slot.status === 'available'))) {
        setSubmitError('That full reservation range is not available on this assigned court. Choose another start time.')
        return
      }
      applySlots(range)
      return
    }
    const currentSlots = selectedSlots.filter((selected) => !isPastTime(selected))
    if (!currentSlots.length) {
      applySlots([label])
      return
    }
    const sorted = [...currentSlots].sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
    const clicked = timeToMinutes(label)
    const first = timeToMinutes(sorted[0])
    const last = timeToMinutes(sorted.at(-1))
    let next
    if (label === sorted[0] && sorted.length > 1) next = sorted.slice(1)
    else if (label === sorted.at(-1) && sorted.length > 1) next = sorted.slice(0, -1)
    else if (clicked === first - 60 || clicked === last + 60) {
      const nextStart = Math.min(first, clicked)
      const nextEnd = Math.max(last, clicked)
      next = Array.from({ length: (nextEnd - nextStart) / 60 + 1 }, (_, index) => `${String(Math.floor((nextStart + index * 60) / 60)).padStart(2, '0')}:00`)
    } else next = [label]
    if (!activeCourt || !next.every((slotLabel) => activeCourt.slots.some((slot) => slot.label === slotLabel && slot.status === 'available'))) {
      setSubmitError('That time range is not open on this court. Choose another range or change this court.')
      return
    }
    applySlots(next)
  }

  function chooseAlternative(alternative) {
    setCourtIds(alternative.courtIds)
    setCourtSchedules(Array.from({ length: Number(quantity) }, () => [...alternative.labels]))
    setCourtStep(0)
    setConfirmedSteps([])
    setSubmitError('')
  }

  function markCourtReady() {
    if (selectedSlots.some(isPastTime)) {
      setSubmitError('A selected court time has already started or passed. Choose a later time slot for this court.')
      return
    }
    if (!selectedSlots.length || !activeRangeAvailable) {
      setSubmitError(`Choose an available continuous time range for Court ${courtStep + 1}.`)
      return
    }
    const next = [...new Set([...confirmedSteps, courtStep])]
    setConfirmedSteps(next)
    if (courtStep < Number(quantity) - 1) setCourtStep(courtStep + 1)
  }

  function updateCourtForStep(value) {
    const next = [...courtIds]
    next[courtStep] = Number(value)
    setCourtIds(next)
    setConfirmedSteps([])
    setSubmitError('')
  }

  async function continueBooking() {
    setSubmitError('')
    if (courtBookings.some((booking) => booking.selectedSlots.some(isPastTime))) {
      setSubmitError('A selected court time has already started or passed. Choose later time slots before continuing.')
      return
    }
    if (selectedCourtBookings.length !== Number(quantity) || !currentRangeAvailable || confirmedSteps.length !== Number(quantity)) {
      setSubmitError('Choose and confirm an available continuous time range for every selected court.')
      return
    }
    if (!data.facility.active || !data.availability.active) {
      setSubmitError('This facility is under maintenance and can only be viewed. Booking is unavailable.')
      return
    }
    setIsSaving(true)
    try {
      await reservationService.saveBookingDraft({
        facilityId,
        facilityName: data.facility.name,
        ownerId: data.facility.ownerId,
        hourlyRate,
        courtRate,
        date,
        time: startTime,
        endTime,
        duration,
        quantity: Number(quantity),
        courtIds,
        courtBookings,
        selectedSlots: bookingSlots,
        rescheduleId: rescheduleId || null,
        total: courtRate,
        equipmentItems,
        equipmentTotal,
      })
      navigate('/confirm-booking')
    } catch (saveError) {
      setSubmitError(saveError instanceof Error ? saveError.message : 'Unable to save your selection.')
    } finally {
      setIsSaving(false)
    }
  }

  const conflictNotice = location.state?.bookingConflict

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeading title={rescheduleId ? 'Reschedule Booking' : 'Choose a Schedule'} description="Select a date and adjacent hourly slots to set the time range." />
      {conflictNotice ? <p role="status" className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{conflictNotice} The schedule below is refreshed; choose one of the available ranges.</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {data ? (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Selected facility</p>
              <h2 className="mt-1 text-base font-bold">{data.facility.name}</h2>
              <p className="mt-1 text-xs text-muted">{data.facility.sport} · {data.facility.price}</p>
              {!data.facility.active || !data.availability.active ? <p className="mt-2 text-xs font-semibold text-amber-300">Under maintenance · viewing only, booking unavailable</p> : null}
            </div>
            <label className="block min-w-48">
              <span className="mb-1.5 block text-xs font-medium text-muted">Reservation date</span>
              <input type="date" min={today} value={date} onChange={(event) => { setDate(event.target.value); setCourtSchedules((previous) => previous.map(() => [])); setConfirmedSteps([]); setSubmitError('') }} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
          </Card>

          <Card>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold">Available time slots</h2>
                <p className="mt-1 text-xs text-muted">Select adjacent hourly slots. Each additional slot extends your time range by one hour.</p>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-success" />Available</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent" />Selected</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent" />Booked</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-danger" />Maintenance</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border border-danger bg-danger/15" />Past</span>
              </div>
            </div>
            {courts.length ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Select label="Number of courts" value={quantity} disabled={Boolean(rescheduleId)} onChange={(event) => { const nextQuantity = Number(event.target.value); setQuantity(String(nextQuantity)); setCourtStep(0); setCourtSchedules(Array.from({ length: nextQuantity }, () => [])); setConfirmedSteps([]); setSubmitError('') }} options={Array.from({ length: maxCourts }, (_, index) => ({ value: String(index + 1), label: `${index + 1} ${index === 0 ? 'court' : 'courts'}` }))} />
                  {rescheduleId ? <p className="pb-2 text-xs text-muted">Assigned courts and deposit are kept for this reschedule.</p> : <p className="pb-2 text-xs text-muted">Court schedules are shown one at a time.</p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: Number(quantity) }, (_, index) => <span key={index} className={`rounded px-2 py-1 text-xs font-semibold ${index === courtStep ? 'bg-accent text-white' : confirmedSteps.includes(index) ? 'bg-success/20 text-success' : 'bg-surface text-muted'}`}>Court {index + 1}{confirmedSteps.includes(index) ? ' ✓' : ''}</span>)}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={courtStep === 0} onClick={() => setCourtStep((step) => Math.max(0, step - 1))}>Previous</Button>
                    {courtStep < Number(quantity) - 1 ? <Button variant="secondary" disabled={!activeRangeAvailable || !selectedSlots.length || !data.facility.active} onClick={markCourtReady}>Use time for Court {courtStep + 1} · Next</Button> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="w-full sm:max-w-xs">
                    <Select label={`Court ${courtStep + 1} schedule`} value={String(activeCourtId ?? '')} disabled={Boolean(rescheduleId)} onChange={(event) => updateCourtForStep(event.target.value)} options={courts.map((court) => {
                      const assignedStep = courtIds.findIndex((id, index) => index !== courtStep && Number(id) === Number(court.courtId))
                      return { value: String(court.courtId), label: assignedStep >= 0 ? `Court ${court.courtNumber} · used for Court ${assignedStep + 1}` : `Court ${court.courtNumber}`, disabled: assignedStep >= 0 }
                    })} />
                  </div>
                  <p className="pb-2 text-xs text-muted">{activeCourt ? `Showing availability for Court ${activeCourt.courtNumber}` : 'Choose a court.'}</p>
                </div>
                {activeCourt?.dateBlocked ? (
                  <div role="status" className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger">
                    <p className="font-bold">This court is blocked for {date}. It remains visible for information, but can’t be booked on this date.</p>
                    <p className="mt-1 text-xs">Reason: {activeCourt.dateBlockReason || 'Unavailable all day.'}</p>
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {(activeCourt?.slots ?? []).map((slot) => {
                    const selected = selectedSlots.includes(slot.label)
                    const past = isPastTime(slot.label)
                    const slotStatus = past ? 'past' : selected && slot.status === 'available' ? 'selected' : slot.status === 'maintenance' ? 'maintenance' : slot.status === 'taken' ? 'taken' : 'available'
                    return (
                      <TimeSlot
                        key={slot.label}
                        availability={slotStatus}
                        disabled={!past && (!data.facility.active || !data.availability.active || slot.status !== 'available')}
                        title={past ? 'This time has already started or passed' : slot.reason || (slot.status === 'taken' ? 'Already reserved' : undefined)}
                        aria-label={`${formatTimeRange(slot.label, 1).label}${past ? ', past time, cannot be booked' : slot.status === 'maintenance' ? `, unavailable${slot.reason ? `: ${slot.reason}` : ''}` : slot.status === 'taken' ? ', booked' : ''}${selected ? ', selected' : ''}`}
                        onClick={() => selectSlot(slot.label, slot.status)}
                      >
                        <span className="block">{formatTimeRange(slot.label, 1).label.replace(/:00/g, '')}</span>
                        {slot.status === 'maintenance' && slot.reason ? <span className="mt-0.5 block truncate text-[9px] font-normal">{slot.reason}</span> : null}
                      </TimeSlot>
                    )
                  })}
                </div>
                {selectedSlots.some(isPastTime) ? <p role="alert" className="mt-3 text-sm text-danger">A selected time slot has already started or passed. Choose later time slots to continue.</p> : null}
                {selectedSlots.length > 0 && !activeRangeAvailable && !selectedSlots.some(isPastTime) ? <p role="alert" className="mt-3 text-sm text-danger">The selected range is unavailable on Court {courtStep + 1}. Choose a different court or time.</p> : null}
                {activeCourt && selectedSlots.length ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-3">
                    <p className="text-sm">Court {courtStep + 1} selected range: <strong className="text-text">{activeTimeRange?.label}</strong></p>
                    {courtStep === Number(quantity) - 1 ? <Button disabled={!activeRangeAvailable || !data.facility.active || confirmedSteps.includes(courtStep)} onClick={markCourtReady}>{confirmedSteps.includes(courtStep) ? `Court ${courtStep + 1} ready` : `Use time for Court ${courtStep + 1}`}</Button> : null}
                  </div>
                ) : null}
                {alternatives.length && (submitError || conflictNotice) ? (
                  <div className="mt-4 rounded-md border border-border p-3">
                    <p className="text-xs font-semibold text-text">Available alternatives for {Math.max(1, selectedSlots.length || durationHint)} {(selectedSlots.length || durationHint) === 1 ? 'hour' : 'hours'}</p>
                    <div className="mt-2 flex flex-wrap gap-2">{alternatives.map((alternative) => <Button key={alternative.labels[0]} variant="secondary" className="text-xs" onClick={() => chooseAlternative(alternative)}>{formatTimeRange(alternative.labels[0], alternative.labels.length).label}</Button>)}</div>
                  </div>
                ) : null}
              </>
            ) : <p className="mt-4 text-sm text-muted">No courts are configured for this facility.</p>}
          </Card>

          {selectedCourtBookings.length ? (
            <Card>
              <h2 className="text-sm font-bold">Selected court schedules</h2>
              <div className="mt-3 divide-y divide-border">
                {selectedCourtBookings.map((booking) => (
                  <div key={booking.courtId} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <p className="text-sm"><span className="font-semibold">Court {booking.courtNumber}</span><span className="text-muted"> · {formatTimeRange(booking.startTime, booking.duration).label} · {booking.duration} {booking.duration === 1 ? 'hour' : 'hours'}</span></p>
                    <span className="text-sm font-semibold text-accent">{formatPHP(booking.duration * hourlyRate)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted">Total court charges · {totalSelectedHours} {totalSelectedHours === 1 ? 'hour' : 'hours'}</span>
                <strong className="text-accent">{formatPHP(courtRate)}</strong>
              </div>
            </Card>
          ) : null}
          {hasEquipmentRental && !rescheduleId ? (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-bold">Equipment Rental</h2><p className="mt-1 text-xs text-muted">{equipmentItems.reduce((total, item) => total + Number(item.quantity), 0)} item(s) selected · {formatPHP(equipmentTotal)} · Hourly prices update from your selected court times.</p></div>
              <Button type="button" variant="secondary" onClick={() => setEquipmentModalOpen(true)}>{equipmentItems.length ? 'Edit rentals' : 'Rent equipment'}</Button>
            </Card>
          ) : null}
          {hasEquipmentRental && !rescheduleId ? (
            <EquipmentRentalModal
              open={equipmentModalOpen}
              facility={data.facility}
              courtBookings={selectedCourtBookings}
              initialItems={equipmentItems}
              onClose={() => setEquipmentModalOpen(false)}
              onApply={setEquipmentItems}
            />
          ) : null}
          {submitError ? <p role="alert" className="text-sm text-danger">{submitError}</p> : null}
          <Card className="flex flex-wrap justify-between gap-2">
            <Link to="/sports-facilities" className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-text">Back</Link>
            <Button disabled={selectedCourtBookings.length !== Number(quantity) || !currentRangeAvailable || confirmedSteps.length !== Number(quantity) || !data.facility.active || isLoading || isSaving} onClick={continueBooking}>{isSaving ? 'Saving…' : rescheduleId ? 'Review reschedule' : 'Next'}</Button>
          </Card>
        </>
      ) : null}
    </div>
  )
}

export default SchedulePage
