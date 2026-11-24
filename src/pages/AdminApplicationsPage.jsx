import { useCallback, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import Table from '../components/ui/Table'
import useAsyncResource from '../hooks/useAsyncResource'
import { adminService } from '../services/adminService'

function AdminApplicationsPage() {
  const loader = useCallback(() => adminService.getApplications(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [selected, setSelected] = useState(null)
  const [reviewNote, setReviewNote] = useState('')
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [facilityPageInput, setFacilityPageInput] = useState('1')
  const [selectedFacilityIndex, setSelectedFacilityIndex] = useState(0)
  const applications = data ?? []
  const pendingCount = applications.filter((application) => application.status === 'Pending review').length
  const reviewFacilities = selected?.facilities?.length
    ? selected.facilities
    : selected?.facility ? [selected.facility] : []
  const selectedFacility = reviewFacilities[selectedFacilityIndex]

  function goToFacilityPage(value) {
    const parsed = Number(value)
    const page = Math.max(1, Math.min(reviewFacilities.length || 1,
      Number.isInteger(parsed) ? parsed : selectedFacilityIndex + 1))
    setSelectedFacilityIndex(page - 1)
    setFacilityPageInput(String(page))
  }

  async function review(status) {
    if (!selected) return
    setIsSaving(true)
    setFormError('')
    try {
      await adminService.reviewApplication(selected.id, status, reviewNote)
      setSelected(null)
      setReviewNote('')
      reload()
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'The application decision could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const columns = [
    { key: 'id', label: 'Application ID', className: 'whitespace-nowrap font-semibold' },
    { key: 'owner', label: 'Applicant', render: (application) => <div><p className="font-semibold">{application.owner.fullName}</p><p className="text-xs text-muted">{application.owner.email}</p></div> },
    { key: 'business', label: 'Business', render: (application) => application.business.name },
    { key: 'facility', label: 'Facilities', render: (application) => application.facilities?.length > 1 ? `${application.facility.name} +${application.facilities.length - 1}` : application.facility.name },
    { key: 'submittedAt', label: 'Submitted', className: 'whitespace-nowrap', render: (application) => new Date(application.submittedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) },
    { key: 'status', label: 'Status', render: (application) => <Badge tone={application.status === 'Approved' ? 'success' : application.status === 'Needs changes' ? 'danger' : 'pending'}>{application.status}</Badge> },
    { key: 'actions', label: 'Review', render: (application) => <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={() => { setSelected(application); setSelectedFacilityIndex(0); setFacilityPageInput('1'); setReviewNote(application.reviewNote ?? ''); setFormError('') }}>View details</Button> },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading title="Facility Applications" description="Review owner and business details before approving new listings." />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{pendingCount} applications awaiting review</p>
        <Badge tone="pending">{pendingCount} Pending</Badge>
      </div>
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !applications.length} emptyMessage="No facility applications have been submitted." />
      {!isLoading && !error && applications.length ? <Table columns={columns} rows={applications} rowKey="id" caption="Facility owner applications" /> : null}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Review facility application" className="max-h-[90vh] overflow-y-auto">
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-xs text-muted">{selected.id}</p><h3 className="mt-1 text-lg font-bold">{selected.business.name}</h3></div>
              <Badge tone={selected.status === 'Approved' ? 'success' : selected.status === 'Needs changes' ? 'danger' : 'pending'}>{selected.status}</Badge>
            </div>
            <div className="grid gap-2 rounded-md border border-border bg-bg p-3 text-xs sm:grid-cols-2">
              <Detail label="Applicant" value={selected.owner.fullName} />
              <Detail label="Email" value={selected.owner.email} />
              <Detail label="Owner phone" value={selected.owner.phone} />
              <Detail label="Business contact" value={selected.business.contact} />
              <Detail label="Business address" value={selected.business.address} />
              <Detail label="Relationship" value={selected.business.ownership} />
            </div>
            {selectedFacility ? (
              <section aria-label="Facility listing details" className="space-y-3 rounded-md border border-border bg-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-accent">Facility {selectedFacilityIndex + 1} of {reviewFacilities.length}</h4>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      disabled={selectedFacilityIndex === 0 || isSaving}
                      onClick={() => goToFacilityPage(selectedFacilityIndex)}
                      aria-label="Previous facility"
                    >Previous</Button>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <span>Facility</span>
                      <input
                        aria-label="Facility number"
                        type="number"
                        min="1"
                        max={reviewFacilities.length}
                        step="1"
                        inputMode="numeric"
                        value={facilityPageInput}
                        disabled={isSaving}
                        onChange={(event) => {
                          const value = event.target.value
                          setFacilityPageInput(value)
                          if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= reviewFacilities.length) {
                            setSelectedFacilityIndex(Number(value) - 1)
                          }
                        }}
                        onBlur={() => goToFacilityPage(facilityPageInput)}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                        className="h-8 w-14 rounded border border-border bg-surface px-2 text-center text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <span>of {reviewFacilities.length}</span>
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      disabled={selectedFacilityIndex >= reviewFacilities.length - 1 || isSaving}
                      onClick={() => goToFacilityPage(selectedFacilityIndex + 2)}
                      aria-label="Next facility"
                    >Next</Button>
                  </div>
                </div>
                <div className="rounded border border-border bg-surface p-3">
                  <h5 className="mb-2 text-sm font-bold">{selectedFacility.name}</h5>
                  {selectedFacility.image ? (
                    <img src={selectedFacility.image} alt={`${selectedFacility.name} photo submitted by the facility owner`} className="mb-3 h-auto max-h-64 w-full rounded border border-border bg-bg object-contain" />
                  ) : (
                    <p className="mb-3 rounded border border-border bg-bg px-3 py-4 text-center text-xs text-muted">No facility photo submitted.</p>
                  )}
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <Detail label="Sport" value={selectedFacility.sport} />
                    <Detail label="Courts / areas" value={selectedFacility.courtCount} />
                    <Detail label="Hourly rate" value={`₱${selectedFacility.hourlyRate}`} />
                    <Detail label="Operating hours" value={`${selectedFacility.openingTime}–${selectedFacility.closingTime}`} />
                    <Detail label="Amenities" value={selectedFacility.amenities?.join(', ') || 'None listed'} />
                  </dl>
                  {selectedFacility.equipmentCategories?.length ? <div className="mt-3 space-y-2 rounded border border-border bg-bg p-3">
                    <h6 className="text-xs font-bold">Equipment rental catalog</h6>
                    {selectedFacility.equipmentCategories.map((category, categoryIndex) => <div key={`${category.name}-${categoryIndex}`}>
                      <p className="text-[11px] font-semibold text-accent">{category.name}</p>
                      <div className="mt-1 space-y-1">{(category.items ?? []).map((item, itemIndex) => <div key={`${item.name}-${itemIndex}`} className="flex items-center gap-2 text-[10px] text-muted">
                        {item.image ? <img src={item.image} alt="" className="h-8 w-10 rounded object-cover" /> : null}
                        <span className="flex-1">{item.name} · {item.stockQuantity} available</span>
                        <span>₱{Number(item.unitPrice).toFixed(2)} / {item.billingUnit === 'hour' ? 'hour' : 'item'}</span>
                      </div>)}</div>
                    </div>)}
                  </div> : null}
                </div>
              </section>
            ) : null}
            {!selected.detailsComplete ? (
              <p role="alert" className="rounded border border-danger/30 bg-danger/10 p-3 text-xs leading-5 text-danger">
                Some registration details are missing. Request an updated application before approving these facilities.
              </p>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Review note (required when requesting changes)</span>
              <textarea rows="3" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="Explain what the applicant should update." />
            </label>
            {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              <Button variant="danger" disabled={isSaving || selected.status === 'Needs changes'} onClick={() => review('Needs changes')}>{isSaving ? 'Saving…' : 'Request changes'}</Button>
              <Button disabled={isSaving || selected.status === 'Approved' || !selected.detailsComplete} onClick={() => review('Approved')}>{isSaving ? 'Saving…' : 'Approve listings'}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function Detail({ label, value }) {
  return <div><dt className="text-muted">{label}</dt><dd className="mt-1 font-medium text-text">{value}</dd></div>
}

export default AdminApplicationsPage
