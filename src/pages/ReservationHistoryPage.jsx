import { useCallback, useState } from 'react'
import Badge from '../components/ui/Badge'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import ReservationPaymentAuditModal from '../components/payment/ReservationPaymentAuditModal'
import DisputeEvidencePicker from '../components/disputes/DisputeEvidencePicker'
import DisputeEvidenceGallery from '../components/disputes/DisputeEvidenceGallery'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { disputeService, isDisputeEligible } from '../services/disputeService'
import { reservationService } from '../services/reservationService'
import { settingsService } from '../services/settingsService'
import { formatPHP } from '../utils/fees'

const statusTones = { Completed: 'success', Pending: 'pending', Cancelled: 'danger', 'No-show': 'danger' }
const disputeReasons = [
  'Facility was unavailable',
  'Facility condition or safety issue',
  'Service not provided as booked',
  'Incorrect charge or refund',
  'Other',
]

function ReservationHistoryPage() {
  const loader = useCallback(async () => {
    const [history, settings, disputes] = await Promise.all([
      reservationService.getHistory(),
      settingsService.getSettings(),
      disputeService.getDisputes(),
    ])
    return {
      rows: history.map((row) => ({
        ...row,
        dispute: disputes.find((dispute) => Number(dispute.reservationId) === Number(row.id)) ?? null,
        hasDispute: disputes.some((dispute) => Number(dispute.reservationId) === Number(row.id)),
        hasOpenDispute: disputes.some((dispute) => Number(dispute.reservationId) === Number(row.id) && dispute.status === 'Open'),
      })),
      disputeWindowHours: settings.refundPolicy.disputeWindowHours,
    }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const rows = data?.rows ?? []
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [evidenceItems, setEvidenceItems] = useState([])
  const [submittedDisputeId, setSubmittedDisputeId] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const [auditReservationId, setAuditReservationId] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [reportError, setReportError] = useState('')

  async function submitDispute(event) {
    event.preventDefault()
    if (!selected || (!submittedDisputeId && (!reason || !details.trim()))) {
      setSubmitError('Choose a reason and describe the problem.')
      return
    }
    if (evidenceItems.some((item) => !item.description.trim())) {
      setSubmitError('Add a short description for each proof photo, or remove that photo.')
      return
    }
    setIsSubmitting(true)
    setSubmitError('')
    try {
      let disputeId = submittedDisputeId
      if (!disputeId) {
        const dispute = await disputeService.createDispute({ reservationId: selected.id, reason, details })
        disputeId = dispute.id
        setSubmittedDisputeId(disputeId)
      }
      let failedUploads = 0
      for (const item of evidenceItems) {
        if (item.uploaded) continue
        try {
          await disputeService.addEvidence(disputeId, 'user', item)
          setEvidenceItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, uploaded: true } : entry))
        } catch {
          failedUploads += 1
        }
      }
      reload()
      if (failedUploads) {
        setNotice('Your problem report was submitted. Some proof photos could not be uploaded; retry the remaining uploads here.')
        setSubmitError(`${failedUploads} photo upload${failedUploads === 1 ? '' : 's'} failed. Check your connection and retry.`)
      } else {
        setSelected(null)
        setReason('')
        setDetails('')
        setEvidenceItems([])
        setSubmittedDisputeId('')
        setNotice('Your problem report and proof photos were submitted. The facility owner and administrator were notified.')
      }
    } catch (submissionError) {
      setSubmitError(submissionError instanceof Error ? submissionError.message : 'Your report could not be submitted.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns = [
    { key: 'facility', label: 'Facility' },
    { key: 'date', label: 'Date' },
    {
      key: 'courtSchedules',
      label: 'Court schedules',
      render: (row) => row.courtSchedules?.length ? (
        <div className="min-w-36 space-y-1 text-xs">
          {row.courtSchedules.map((court, index) => (
            <p key={court.courtId ?? index}>Court {court.courtNumber ?? index + 1}: {court.startTime} - {court.endTime}</p>
          ))}
        </div>
      ) : row.startTime && row.endTime ? `${row.startTime} - ${row.endTime}` : '—',
    },
    { key: 'duration', label: 'Total court hours' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={statusTones[row.status] ?? 'neutral'}>{row.status}</Badge>
          {Number(row.dispute?.refund?.totalRefunded ?? row.refundedAmount) > 0 ? <Badge tone="info">Refund</Badge> : null}
          {row.hasOpenDispute ? <Badge tone="pending">Disputed</Badge> : null}
        </div>
      ),
    },
    {
      key: 'total',
      label: 'Total paid',
      className: 'text-right font-semibold text-accent',
      render: (row) => Number.isFinite(Number(row.userTotal))
        ? formatPHP(row.userTotal)
        : row.total,
    },
    {
      key: 'refundedAmount',
      label: 'Refunded',
      className: 'text-right',
      render: (row) => {
        if (row.dispute?.resolution === 'reject') return <span className="inline-flex items-center justify-end gap-1.5 text-xs font-semibold text-danger"><OutcomeMark rejected />Rejected</span>
        const refunded = Number(row.dispute?.refund?.totalRefunded ?? row.refundedAmount)
        return refunded > 0 ? <div className="text-right"><span className="inline-flex items-center justify-end gap-1.5 text-xs font-semibold text-success"><OutcomeMark />{formatPHP(refunded)}</span></div> : '—'
      },
    },
    {
      key: 'disputeOutcome',
      label: 'Problem report',
      render: (row) => {
        const resolution = row.dispute?.resolution
        if (resolution === 'reject' || resolution === 'full-refund' || resolution === 'partial-refund') return <span className="text-xs text-muted">Resolved</span>
        if (row.dispute?.status === 'Open') return <Badge tone="pending">{row.dispute.ownerResponse?.submittedAt ? 'Awaiting admin' : 'Awaiting owner'}</Badge>
        return '—'
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => {
        const canReport = row.id && row.status === 'Completed' &&
          !row.hasDispute &&
          isDisputeEligible(row, data.disputeWindowHours)
        return (
          <div className="flex flex-wrap gap-1.5">
            {Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0 ? <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setAuditReservationId(Number(row.id))}>Receipt / audit</Button> : null}
            {canReport ? <Button variant="info" className="px-2.5 py-1.5 text-xs" onClick={() => {
              setSelected(row)
              setSubmitError('')
              setReason('')
              setDetails('')
              setEvidenceItems([])
              setSubmittedDisputeId('')
            }}>Report a problem</Button> : null}
            {row.dispute ? <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={async () => {
              setReportError('')
              setSelectedReport(null)
              setIsLoadingReport(true)
              try { setSelectedReport(await disputeService.getDisputeDetails(row.dispute.id)) }
              catch (detailError) { setReportError(detailError.message || 'Problem report could not be loaded.') }
              finally { setIsLoadingReport(false) }
            }}>View report</Button> : null}
          </div>
        )
      },
    },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading title="Reservation History" description="A record of your past and current bookings." />
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !rows.length} emptyMessage="Your reservation history is empty." />
      {!isLoading && !error && rows.length ? <Table columns={columns} rows={rows} rowKey="id" caption="Reservation history" /> : null}
      <Modal
        open={Boolean(selected)}
        onClose={() => {
          if (!isSubmitting) setSelected(null)
        }}
        title="Report a problem"
      >
        {selected ? (
          <form className="space-y-4" onSubmit={submitDispute}>
            <p className="text-sm text-muted">
              Tell us what happened with <span className="font-semibold text-text">{selected.facility}</span>.
            </p>
            <Select
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              options={[
                { value: '', label: 'Choose a reason' },
                ...disputeReasons,
              ]}
              required
            />
            <div>
              <label htmlFor="dispute-details" className="mb-1.5 block text-xs font-medium text-muted">
                Details
              </label>
              <textarea
                id="dispute-details"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={4}
                maxLength={1000}
                required
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
                placeholder="Describe the problem and what outcome you are requesting."
              />
            </div>
            <DisputeEvidencePicker items={evidenceItems} onChange={setEvidenceItems} disabled={isSubmitting} />
            {submitError ? <p role="alert" className="text-sm text-danger">{submitError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={isSubmitting} onClick={() => setSelected(null)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || (!submittedDisputeId && (!reason || !details.trim())) || evidenceItems.some((item) => !item.description.trim())}>
                {isSubmitting ? 'Submitting…' : 'Submit report'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
      <Modal open={Boolean(selectedReport) || isLoadingReport || Boolean(reportError)} onClose={() => { setSelectedReport(null); setReportError('') }} title="Problem report & response" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {isLoadingReport ? <p role="status" className="text-sm text-muted">Loading report...</p> : null}
        {reportError ? <p role="alert" className="text-sm text-danger">{reportError}</p> : null}
        {selectedReport ? <div className="space-y-4 text-sm">
          <div className="rounded-md border border-border bg-bg p-3"><p><span className="text-muted">Facility:</span> {selectedReport.facility}</p><p className="mt-1"><span className="text-muted">Reason:</span> {selectedReport.reason}</p><p className="mt-2 whitespace-pre-wrap">{selectedReport.details}</p><DisputeEvidenceGallery title="Your proof" items={selectedReport.userEvidence ?? []} /></div>
          {selectedReport.ownerResponse ? <div className="rounded-md border border-border p-3"><h3 className="font-semibold">Facility owner response</h3><p className="mt-2 whitespace-pre-wrap">{selectedReport.ownerResponse.details}</p><DisputeEvidenceGallery title="Owner proof" items={selectedReport.ownerEvidence ?? []} /></div> : <p className="rounded-md border border-border p-3 text-xs text-muted">Waiting for the facility owner to submit their response before administrator review.</p>}
          {selectedReport.resolution ? <div className="rounded-md border border-border p-3"><h3 className="font-semibold">Administrator decision</h3><p className="mt-1">{selectedReport.resolution === 'reject' ? 'Dispute rejected. No refund was approved.' : `${selectedReport.resolution === 'full-refund' ? 'Full' : 'Partial'} refund approved: ${formatPHP(selectedReport.refund?.totalRefunded ?? 0)}.`}</p><p className="mt-2 whitespace-pre-wrap text-muted">Note to both sides: {selectedReport.resolutionNote}</p></div> : null}
        </div> : null}
      </Modal>
      <ReservationPaymentAuditModal
        open={Boolean(auditReservationId)}
        reservationId={auditReservationId}
        onClose={() => setAuditReservationId(null)}
      />
    </div>
  )
}

function OutcomeMark({ rejected = false }) {
  return <span aria-hidden="true" className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${rejected ? 'bg-danger text-white' : 'bg-success text-white'}`}>
    {rejected ? <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="m4 4 8 8M12 4l-8 8" /></svg> : <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 8 3 3 7-7" /></svg>}
  </span>
}

export default ReservationHistoryPage
