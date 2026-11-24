import { useCallback, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import AmenityEquipmentEditor from '../components/facility/AmenityEquipmentEditor'
import FacilityArtwork from '../components/facility/FacilityArtwork'
import FacilityColorPicker from '../components/facility/FacilityColorPicker'
import FacilityPhotoPicker from '../components/facility/FacilityPhotoPicker'
import FacilityScheduleEditor from '../components/facility/FacilityScheduleEditor'
import PageHeading from '../components/ui/PageHeading'
import useAsyncResource from '../hooks/useAsyncResource'
import { adminService } from '../services/adminService'
import { facilityService } from '../services/facilityService'
import { facilityColorForId, randomFacilityColor } from '../utils/facilityAppearance'

const EMPTY_FORM = { name: '', sport: '', hourlyRate: '', courtCount: '1', image: '', color: '', amenities: [], equipmentCategories: [] }
const EMPTY_USERS = []

function AdminFacilitiesPage() {
  const loader = useCallback(() => adminService.getFacilities(), [])
  const usersLoader = useCallback(() => adminService.getUsers(), [])
  const sportsLoader = useCallback(() => facilityService.getSports(), [])
  const amenitiesLoader = useCallback(() => facilityService.getAmenities(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const { data: userData } = useAsyncResource(usersLoader)
  const { data: sportData, isLoading: sportsLoading, error: sportsError, reload: reloadSports } = useAsyncResource(sportsLoader)
  const { data: amenityData } = useAsyncResource(amenitiesLoader)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, color: randomFacilityColor() }))
  const [formError, setFormError] = useState('')
  const [pageError, setPageError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)
  const [isCropPending, setIsCropPending] = useState(false)
  const [sportsManagerOpen, setSportsManagerOpen] = useState(false)
  const [newSportName, setNewSportName] = useState('')
  const [quickSportName, setQuickSportName] = useState('')
  const [showQuickSport, setShowQuickSport] = useState(false)
  const [editingSportId, setEditingSportId] = useState(null)
  const [editingSportName, setEditingSportName] = useState('')
  const [sportError, setSportError] = useState('')
  const [isSavingSport, setIsSavingSport] = useState(false)
  const [category, setCategory] = useState('All sports')
  const [ownerQuery, setOwnerQuery] = useState('')
  const facilities = data ?? []
  const sports = sportData ?? []
  const amenityOptions = (amenityData ?? []).map((amenity) => amenity.name)
  const ownerAccounts = (userData ?? EMPTY_USERS).filter((user) =>
    user.role === 'Facility owner' && user.status === 'Active',
  )
  const assignedOwners = facilities.filter((facility) => facility.owner).map((facility) => facility.owner)
  const ownerOptions = Array.from(new Map(
    [...ownerAccounts.map((owner) => ({ id: owner.id, name: owner.name, email: owner.email })), ...assignedOwners]
      .map((owner) => [owner.email, owner]),
  ).values())
  const normalizedOwnerQuery = ownerQuery.trim().toLowerCase()
  const visible = facilities.filter((facility) =>
    (category === 'All sports' || facility.sport === category) &&
    (!normalizedOwnerQuery ||
      `${facility.owner?.name ?? 'unassigned'} ${facility.owner?.email ?? ''}`.toLowerCase().includes(normalizedOwnerQuery)),
  )
  const groupedFacilities = visible.reduce((groups, facility) => {
    const key = facility.owner?.email ?? 'unassigned'
    if (!groups[key]) groups[key] = { owner: facility.owner, facilities: [] }
    groups[key].facilities.push(facility)
    return groups
  }, {})

  function openCreate() {
    setSelected('new')
    setIsCropPending(false)
    setShowQuickSport(false)
    setQuickSportName('')
    setForm({ ...EMPTY_FORM, sport: sports[0]?.name ?? '', ownerEmail: ownerAccounts[0]?.email ?? '', color: randomFacilityColor() })
    setFormError('')
  }

  async function addSport(event) {
    event.preventDefault()
    const name = newSportName.trim()
    if (!name) return
    setIsSavingSport(true)
    setSportError('')
    try {
      await facilityService.createSport(name)
      setNewSportName('')
      reloadSports()
    } catch (saveError) {
      setSportError(saveError instanceof Error ? saveError.message : 'The sport type could not be added.')
    } finally {
      setIsSavingSport(false)
    }
  }

  async function addSportForFacility() {
    const name = quickSportName.trim()
    if (!name) return
    setIsSavingSport(true)
    setFormError('')
    try {
      const sport = await facilityService.createSport(name)
      setForm((current) => ({ ...current, sport: sport.name }))
      setQuickSportName('')
      setShowQuickSport(false)
      reloadSports()
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'The sport type could not be added.')
    } finally {
      setIsSavingSport(false)
    }
  }

  async function saveSportName(sport) {
    const name = editingSportName.trim()
    if (!name) return
    setIsSavingSport(true)
    setSportError('')
    try {
      await facilityService.updateSport(sport.id, name)
      if (category === sport.name) setCategory(name)
      setEditingSportId(null)
      reloadSports()
      reload()
    } catch (saveError) {
      setSportError(saveError instanceof Error ? saveError.message : 'The sport type could not be updated.')
    } finally {
      setIsSavingSport(false)
    }
  }

  async function deleteSport(sport) {
    setSportError('')
    setIsSavingSport(true)
    try {
      await facilityService.deleteSport(sport.id)
      if (category === sport.name) setCategory('All sports')
      setEditingSportId(null)
      reloadSports()
    } catch (deleteError) {
      setSportError(deleteError instanceof Error ? deleteError.message : 'The sport type could not be deleted.')
    } finally {
      setIsSavingSport(false)
    }
  }

  async function openEdit(facility) {
    let details = facility
    try {
      details = await facilityService.getFacilityById(facility.id)
    } catch (loadError) {
      setPageError(loadError instanceof Error ? loadError.message : 'Facility details could not be loaded.')
      return
    }
    setSelected(facility)
    setIsCropPending(false)
    setForm({
      name: details.name,
      sport: details.sport,
      hourlyRate: String(details.hourlyRate ?? details.price.replace(/[^\d.]/g, '')),
      courtCount: String(details.courtCount ?? 1),
      ownerEmail: facility.owner?.email ?? '',
      image: details.image ?? '',
      color: details.color ?? facilityColorForId(facility.id),
      amenities: details.amenities ?? [],
      equipmentCategories: details.equipmentCategories ?? [],
    })
    setFormError('')
  }

  async function saveFacility(event) {
    event.preventDefault()
    if (isCropPending) {
      setFormError('Apply the crop or cancel it before saving the facility.')
      return
    }
    const hourlyRate = Number(form.hourlyRate)
    const courtCount = Number(form.courtCount)
    if (!form.name.trim() || !form.sport || !form.ownerEmail || !Number.isFinite(hourlyRate) || hourlyRate <= 0 ||
      !Number.isInteger(courtCount) || courtCount < 1 || courtCount > 20) {
      setFormError('Choose an owner and enter a facility name, valid hourly rate, and 1–20 courts or playing areas.')
      return
    }
    setIsSaving(true)
    setFormError('')
    setPageError('')
    try {
      if (selected === 'new') {
        await adminService.createFacility({ ...form, hourlyRate, courtCount })
      } else {
        await adminService.updateFacility(selected.id, {
          name: form.name.trim(),
          sport: form.sport,
          price: `₱${new Intl.NumberFormat('en-PH').format(hourlyRate)}/hr`,
          courtCount,
          ownerEmail: form.ownerEmail,
          image: form.image || null,
          color: form.color,
          amenities: form.amenities,
          equipmentCategories: form.equipmentCategories,
        })
      }
      setSelected(null)
      setIsCropPending(false)
      reload()
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Facility details could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleListing(facility) {
    setPageError('')
    try {
      await adminService.updateFacility(facility.id, { active: !facility.active })
      reload()
    } catch (updateError) {
      setPageError(updateError instanceof Error ? updateError.message : 'Facility status could not be updated.')
    }
  }

  function openRemove(facility) {
    setRemoveTarget(facility)
    setRemoveReason('')
    setRemoveError('')
  }

  async function confirmRemove(event) {
    event.preventDefault()
    if (!removeTarget || !removeReason.trim() || isRemoving) return
    setIsRemoving(true)
    setRemoveError('')
    try {
      await adminService.removeFacility(removeTarget.id, removeReason.trim())
      setRemoveTarget(null)
      setRemoveReason('')
      reload()
    } catch (removeFailure) {
      setRemoveError(removeFailure instanceof Error ? removeFailure.message : 'The facility could not be removed.')
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading title="Sports Facilities" description="Manage approved venue listings across the RESERVA platform." />
      {sportsError ? <p role="alert" className="text-sm text-danger">Sports could not be loaded from the database. Reload the page and try again.</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-muted">{visible.length} of {facilities.length} facilities</p>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="block min-w-40 flex-1 sm:flex-none">
            <span className="mb-1.5 block text-xs font-medium text-muted">Sport</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text">
              <option>All sports</option>
              {sports.map((sport) => <option key={sport.id} value={sport.name}>{sport.name}</option>)}
            </select>
          </label>
          <label className="block min-w-56 flex-1 sm:w-64 sm:flex-none">
            <span className="mb-1.5 block text-xs font-medium text-muted">Search owner</span>
            <input
              type="search"
              value={ownerQuery}
              onChange={(event) => setOwnerQuery(event.target.value)}
              placeholder="Name or email"
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <Button variant="secondary" onClick={() => { setSportsManagerOpen(true); setSportError('') }}>Manage sport types</Button>
          <Button onClick={openCreate}>Add facility</Button>
        </div>
      </div>
      {pageError ? <p role="alert" className="text-sm text-danger">{pageError}</p> : null}
      <AsyncState
        loading={isLoading}
        error={error}
        onRetry={reload}
        empty={!isLoading && !error && !visible.length}
        emptyMessage={normalizedOwnerQuery ? 'No facility owners match your search and sport filter.' : 'No facilities match this sport.'}
      />
      {!isLoading && !error && visible.length ? (
        <div className="space-y-5">
          {Object.entries(groupedFacilities).map(([ownerKey, group]) => (
            <section key={ownerKey} aria-labelledby={`owner-${ownerKey}`} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                <div>
                  <h2 id={`owner-${ownerKey}`} className="text-sm font-bold">{group.owner?.name ?? 'Unassigned facilities'}</h2>
                  {group.owner ? <p className="mt-1 text-xs text-muted">{group.owner.email}</p> : null}
                </div>
                <span className="text-xs text-muted">{group.facilities.length} {group.facilities.length === 1 ? 'facility' : 'facilities'}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.facilities.map((facility) => (
                  <Card key={facility.id} className="flex flex-col overflow-hidden p-0">
                    <FacilityArtwork facility={facility} className="min-h-20" showStatus showEquipmentRental />
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                        <div><p className="text-[10px] text-muted">Rate per hour</p><p className="mt-1 text-sm font-bold text-accent">{facility.price}</p></div>
                        <div><p className="text-[10px] text-muted">Courts / areas</p><p className="mt-1 text-sm font-semibold">{facility.courtCount ?? 1}</p></div>
                      </div>
                      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3">
                        <Button variant="secondary" className="w-full whitespace-nowrap px-1.5 py-1.5 text-xs" onClick={() => toggleListing(facility)}>{facility.active ? 'Pause' : 'Activate'}</Button>
                        <Button className="w-full px-1.5 py-1.5 text-xs" onClick={() => openEdit(facility)}>Edit</Button>
                        <Button variant="danger" className="w-full px-1.5 py-1.5 text-xs" onClick={() => openRemove(facility)}>Remove</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      <Modal open={Boolean(selected)} onClose={() => { setSelected(null); setIsCropPending(false) }} title={selected === 'new' ? 'Add Facility' : 'Edit Facility'} className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={saveFacility} className="space-y-3">
          <FacilityPhotoPicker
            key={`facility-photo-${selected === 'new' ? 'new' : (selected?.id ?? 'closed')}`}
            value={form.image}
            color={form.color}
            disabled={isSaving}
            onChange={(image) => setForm((current) => ({ ...current, image }))}
            onCropPendingChange={(pending) => { setIsCropPending(pending); if (!pending) setFormError('') }}
          />
          <FacilityColorPicker value={form.color} disabled={isSaving} onChange={(color) => setForm((current) => ({ ...current, color }))} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Owner account</span>
            <select required value={form.ownerEmail ?? ''} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
              <option value="">Choose an active owner</option>
              {ownerOptions.map((owner) => (
                <option key={owner.email} value={owner.email} disabled={!ownerAccounts.some((account) => account.email === owner.email) && selected === 'new'}>
                  {owner.name} · {owner.email}
                </option>
              ))}
            </select>
            {!ownerAccounts.length && selected === 'new' ? <p className="mt-1 text-xs text-danger">There are no active facility-owner accounts available for assignment.</p> : null}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Facility name</span>
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Sport</span>
            <select required value={form.sport} disabled={sportsLoading || !sports.length} onChange={(event) => setForm({ ...form, sport: event.target.value })} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
              <option value="">Choose a sport</option>
              {sports.map((sport) => <option key={sport.id} value={sport.name}>{sport.name}</option>)}
            </select>
          </label>
            {selected === 'new' ? (
              <div className="mt-2">
                {showQuickSport ? (
                  <div className="flex gap-2">
                    <input value={quickSportName} onChange={(event) => setQuickSportName(event.target.value)} maxLength={80} placeholder="New sport name" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm text-text" />
                    <Button type="button" disabled={isSavingSport || !quickSportName.trim()} onClick={addSportForFacility} className="px-3 text-xs">Add type</Button>
                  </div>
                ) : (
                  <Button type="button" variant="ghost" onClick={() => setShowQuickSport(true)} className="px-0 py-1 text-xs">+ Add sport type</Button>
                )}
              </div>
            ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Rate per hour (₱)</span>
              <input required type="number" min="1" step="1" value={form.hourlyRate} onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Courts / areas</span>
              <input required type="number" min="1" max="20" step="1" value={form.courtCount} onChange={(event) => setForm({ ...form, courtCount: event.target.value })} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
          </div>
          <AmenityEquipmentEditor
            amenities={form.amenities}
            amenityOptions={amenityOptions}
            equipmentCategories={form.equipmentCategories}
            disabled={isSaving}
            onAmenitiesChange={(amenities) => setForm((current) => ({ ...current, amenities }))}
            onEquipmentCategoriesChange={(equipmentCategories) => setForm((current) => ({ ...current, equipmentCategories }))}
          />
          {selected && selected !== 'new' ? <FacilityScheduleEditor key={selected.id} facilityId={selected.id} /> : null}
          {isCropPending ? <p role="status" className="text-xs text-muted">Apply the crop to attach this photo, or cancel the crop to save without it.</p> : null}
          {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setSelected(null); setIsCropPending(false) }}>Cancel</Button>
            <Button type="submit" disabled={isSaving || isCropPending}>{isSaving ? 'Saving…' : 'Save facility'}</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(removeTarget)}
        onClose={() => { if (!isRemoving) { setRemoveTarget(null); setRemoveError('') } }}
        title="Are you sure to remove this facility"
      >
        {removeTarget ? (
          <form onSubmit={confirmRemove} className="space-y-3">
            <p className="text-sm leading-5 text-muted">
              Remove <span className="font-semibold text-text">{removeTarget.name}</span> from facility listings? Existing reservation and payment history will be retained. Your reason will be sent to all active users, admins, and facility owners.
            </p>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Reason for removing this facility</span>
              <textarea
                required
                maxLength={1000}
                rows={4}
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
                className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                placeholder="Describe why this facility is being removed"
              />
            </label>
            {removeError ? <p role="alert" className="text-sm text-danger">{removeError}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" disabled={isRemoving} onClick={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveError('') }}>No</Button>
              <Button type="submit" variant="danger" disabled={isRemoving || !removeReason.trim()}>{isRemoving ? 'Removing…' : 'Yes'}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
      <Modal open={sportsManagerOpen} onClose={() => { setSportsManagerOpen(false); setEditingSportId(null); setSportError('') }} title="Manage sport types">
        <div className="space-y-4">
          <form onSubmit={addSport} className="flex gap-2">
            <input required value={newSportName} onChange={(event) => setNewSportName(event.target.value)} maxLength={80} placeholder="New sport type" className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm text-text" />
            <Button type="submit" disabled={isSavingSport || !newSportName.trim()}>Add sport</Button>
          </form>
          {sportError ? <p role="alert" className="text-sm text-danger">{sportError}</p> : null}
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {sports.map((sport) => (
              <li key={sport.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg p-2">
                {editingSportId === sport.id ? (
                  <input autoFocus value={editingSportName} onChange={(event) => setEditingSportName(event.target.value)} maxLength={80} className="h-9 min-w-32 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-text" />
                ) : <span className="min-w-32 flex-1 text-sm font-medium">{sport.name}</span>}
                <div className="flex gap-2">
                  {editingSportId === sport.id ? (
                    <>
                      <Button type="button" disabled={isSavingSport || !editingSportName.trim()} onClick={() => saveSportName(sport)} className="px-2 py-1.5 text-xs">Save</Button>
                      <Button type="button" variant="secondary" onClick={() => setEditingSportId(null)} className="px-2 py-1.5 text-xs">Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="secondary" onClick={() => { setEditingSportId(sport.id); setEditingSportName(sport.name); setSportError('') }} className="px-2 py-1.5 text-xs">Edit</Button>
                      <Button type="button" variant="danger" disabled={isSavingSport} onClick={() => deleteSport(sport)} className="px-2 py-1.5 text-xs">Delete</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">A sport assigned to a facility must be reassigned before it can be deleted.</p>
        </div>
      </Modal>
    </div>
  )
}

export default AdminFacilitiesPage
