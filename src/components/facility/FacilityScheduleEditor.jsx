import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import TimeSlot from '../ui/TimeSlot'
import { facilityService } from '../../services/facilityService'
import { formatTimeRange } from '../../utils/bookingTime'

function getToday() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatSlotRange(label) {
  return formatTimeRange(label, 1).label.replace(/:00/g, '')
}

function FacilityScheduleEditor({ facilityId }) {
  const [date, setDate] = useState(getToday)
  const [courtId, setCourtId] = useState('')
  const [availability, setAvailability] = useState(null)
  const [edits, setEdits] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [reasonTarget, setReasonTarget] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')

  const loadSchedule = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const result = await facilityService.getAvailability(facilityId, date, undefined, true)
      setAvailability(result)
      setCourtId((current) => result.courts.some((court) => String(court.courtId) === current)
        ? current
        : String(result.courts[0]?.courtId ?? ''))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Facility schedule could not be loaded.')
      setAvailability(null)
    } finally {
      setIsLoading(false)
    }
  }, [facilityId, date, retry])

  useEffect(() => {
    loadSchedule().catch(() => {})
  }, [loadSchedule])

  const selectedCourt = availability?.courts.find((court) => String(court.courtId) === courtId)
  const slots = selectedCourt?.slots ?? []
  const hasEdits = Object.keys(edits).length > 0
  const renderedSlots = useMemo(() => slots.map((slot) => ({
    ...slot,
    status: edits[slot.label]?.status ?? slot.status,
    reason: edits[slot.label]?.status === 'unavailable' ? edits[slot.label].reason : slot.reason,
  })), [slots, edits])
  const blockedSlots = renderedSlots.filter((slot) => slot.status === 'maintenance')

  function stageSlot(time, status, blockReason = '') {
    const baseSlot = slots.find((slot) => slot.label === time)
    if (!baseSlot || baseSlot.status === 'taken') return
    const effectiveStatus = status === 'unavailable' ? 'maintenance' : 'available'
    if (baseSlot.status === effectiveStatus && status !== 'unavailable') {
      setEdits((current) => {
        const next = { ...current }
        delete next[time]
        return next
      })
    } else {
      setEdits((current) => ({ ...current, [time]: { status, reason: blockReason } }))
    }
    setSaveError('')
  }

  function unblockAll() {
    if (!blockedSlots.length || isSaving) return
    setEdits((current) => {
      const next = { ...current }
      for (const slot of blockedSlots) {
        const original = slots.find((item) => item.label === slot.label)
        if (original?.status === 'maintenance') next[slot.label] = { status: 'available', reason: '' }
        else delete next[slot.label]
      }
      return next
    })
    setSaveError('')
  }

  function openReason(target) {
    setSelectedSlot(null)
    setReasonTarget(target)
    setReason('')
    setReasonError('')
  }

  function applyReason(event) {
    event.preventDefault()
    const cleanReason = reason.trim()
    if (!cleanReason) {
      setReasonError('Enter a reason for blocking.')
      return
    }
    if (cleanReason.length > 1000) {
      setReasonError('The reason must be 1,000 characters or fewer.')
      return
    }
    if (reasonTarget?.type === 'date') {
      if (slots.some((slot) => slot.status === 'taken')) {
        setReasonError('This court already has a reservation on this date. Resolve the booking before blocking the full date.')
        return
      }
      setEdits(Object.fromEntries(slots.map((slot) => [slot.label, { status: 'unavailable', reason: cleanReason }])))
    } else if (reasonTarget?.type === 'slot') {
      stageSlot(reasonTarget.time, 'unavailable', cleanReason)
    }
    setReasonTarget(null)
    setReason('')
    setReasonError('')
    setSaveError('')
  }

  async function saveChanges() {
    if (!selectedCourt || !hasEdits || isSaving) return
    setIsSaving(true)
    setSaveError('')
    try {
      const changes = Object.entries(edits).map(([time, edit]) => ({ time, status: edit.status, reason: edit.reason }))
      await facilityService.updateAvailability({
        facilityId,
        courtNumber: selectedCourt.courtNumber,
        date,
        changes,
      })
      setEdits({})
      setRetry((value) => value + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Schedule changes could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  function cancelChanges() {
    setEdits({})
    setSaveError('')
    setReasonTarget(null)
    setSelectedSlot(null)
    setReason('')
  }

  function changeDate(nextDate) {
    if (hasEdits) return
    setDate(nextDate)
  }

  function changeCourt(nextCourt) {
    if (hasEdits) return
    setCourtId(nextCourt)
  }

  const statusLabels = { available: 'Available', taken: 'Booked', maintenance: 'Maintenance' }

  return (
    <section className="space-y-3 rounded-md border border-border bg-bg/50 p-3" aria-label="Edit reservation time slots">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Reservation time slots</h3>
          <p className="mt-1 text-xs text-muted">Select a date and court to view or block hourly time slots.</p>
        </div>
        <Button type="button" variant="danger" disabled={isLoading || !selectedCourt || hasEdits} onClick={() => openReason({ type: 'date' })} className="px-2.5 py-1.5 text-xs">
          Block date
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Date</span>
          <input type="date" min={getToday()} value={date} disabled={hasEdits || isSaving} onChange={(event) => changeDate(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Court</span>
          <select value={courtId} disabled={isLoading || hasEdits || isSaving} onChange={(event) => changeCourt(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text">
            {(availability?.courts ?? []).map((court) => <option key={court.courtId} value={court.courtId}>{court.courtName || `Court ${court.courtNumber}`}</option>)}
          </select>
        </label>
      </div>

      {isLoading ? <p role="status" className="py-4 text-center text-xs text-muted">Loading court schedule…</p> : null}
      {loadError ? <div role="alert" className="space-y-2 text-xs text-danger"><p>{loadError}</p><Button type="button" variant="secondary" onClick={() => setRetry((value) => value + 1)} className="px-2 py-1">Retry</Button></div> : null}

      {!isLoading && !loadError && selectedCourt ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-text">{selectedCourt.courtName || `Court ${selectedCourt.courtNumber}`} · {formatDate(date)}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
              {Object.entries(statusLabels).map(([status, label]) => <span key={status} className="flex items-center gap-1"><i className={`h-2 w-2 rounded-sm ${status === 'available' ? 'bg-success' : status === 'taken' ? 'bg-accent' : 'bg-danger'}`} />{label}</span>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {renderedSlots.map((slot) => (
              <TimeSlot
                key={slot.label}
                availability={slot.status === 'maintenance' ? 'maintenance' : slot.status === 'taken' ? 'taken' : 'available'}
                disabled={slot.status === 'taken' || isSaving}
                onClick={() => setSelectedSlot(slot)}
                title={slot.reason || (slot.status === 'taken' ? 'Already reserved' : undefined)}
                aria-label={`${formatSlotRange(slot.label)}${slot.status === 'maintenance' ? `, blocked${slot.reason ? `: ${slot.reason}` : ''}` : slot.status === 'taken' ? ', booked' : ', available'}`}
                className="w-full min-w-0 cursor-pointer px-1.5 py-2 text-center"
              >
                <span className="block">{formatSlotRange(slot.label)}</span>
              </TimeSlot>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold">Blocked times</h4>
                <span className="text-[10px] text-muted">{blockedSlots.length} {blockedSlots.length === 1 ? 'slot' : 'slots'}</span>
              </div>
              {blockedSlots.length ? <Button type="button" variant="secondary" disabled={isSaving} onClick={unblockAll} className="px-2 py-1 text-[10px]">Unblock all</Button> : null}
            </div>
            {blockedSlots.length ? (
              <ul className="mt-2 divide-y divide-border">
                {blockedSlots.map((slot) => (
                  <li key={slot.label} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <span className="font-semibold text-text">{formatSlotRange(slot.label)}</span>
                    <span className="min-w-0 flex-1 text-muted">{slot.reason || 'Unavailable'}</span>
                    <Button type="button" variant="secondary" disabled={isSaving} onClick={() => stageSlot(slot.label, 'available')} className="px-2 py-1 text-[10px]">Unblock</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-muted">No blocked times for this court and date.</p>}
          </div>
          {saveError ? <p role="alert" className="text-xs text-danger">{saveError}</p> : null}
          {hasEdits ? <p role="status" className="text-[10px] text-amber-300">Schedule edits are not saved yet. Date and court are locked until you save or cancel.</p> : null}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="secondary" disabled={!hasEdits || isSaving} onClick={cancelChanges} className="px-3 py-1.5 text-xs">Cancel</Button>
            <Button type="button" disabled={!hasEdits || isSaving} onClick={saveChanges} className="px-3 py-1.5 text-xs">{isSaving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </>
      ) : null}

      <Modal open={Boolean(selectedSlot)} onClose={() => setSelectedSlot(null)} title={selectedSlot ? formatSlotRange(selectedSlot.label) : 'Edit time slot'}>
        {selectedSlot ? <div className="space-y-3">
          <p className="text-xs text-muted">{selectedCourt?.courtName || 'Court'} · {formatDate(date)} · Set this time range as:</p>
          {selectedSlot.status === 'taken' ? <p className="rounded border border-accent/30 bg-accent/10 p-3 text-sm text-accent">This time is booked and cannot be changed here.</p> : (
            <>
              <Button type="button" variant="secondary" disabled={selectedSlot.status === 'available'} onClick={() => { stageSlot(selectedSlot.label, 'available'); setSelectedSlot(null) }} className="w-full justify-between">Available <span>{selectedSlot.status === 'available' ? 'Current' : ''}</span></Button>
              <Button type="button" variant="danger" disabled={selectedSlot.status === 'maintenance'} onClick={() => openReason({ type: 'slot', time: selectedSlot.label })} className="w-full justify-between">Blocked / unavailable</Button>
              {selectedSlot.status === 'maintenance' ? <p className="text-xs text-muted">Already blocked: {selectedSlot.reason || 'No reason provided'}</p> : null}
            </>
          )}
          <div className="flex justify-end"><Button type="button" variant="secondary" onClick={() => setSelectedSlot(null)}>Cancel</Button></div>
        </div> : null}
      </Modal>

      <Modal
        open={Boolean(reasonTarget)}
        onClose={() => { if (!isSaving) { setReasonTarget(null); setReasonError('') } }}
        title={reasonTarget?.type === 'date' ? `Block (${formatDate(date)})` : `Block (${formatSlotRange(reasonTarget?.time ?? '08:00')})`}
      >
        {reasonTarget ? <div className="space-y-3">
          <p className="text-xs text-muted">{reasonTarget.type === 'date'
            ? `${selectedCourt?.courtName || 'Court'}: all time slots will be unavailable.`
            : `${selectedCourt?.courtName || 'Court'}: ${formatDate(date)}.`}</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Reasons for blocking</span>
            <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
          </label>
          {reasonError ? <p role="alert" className="text-xs text-danger">{reasonError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setReasonTarget(null); setReasonError('') }}>Cancel</Button>
            <Button type="button" variant="danger" onClick={applyReason}>{reasonTarget.type === 'date' ? 'Block this date' : 'Block this time'}</Button>
          </div>
        </div> : null}
      </Modal>
    </section>
  )
}

export default FacilityScheduleEditor
