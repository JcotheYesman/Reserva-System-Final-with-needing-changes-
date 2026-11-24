import { useCallback, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import FacilityArtwork from '../components/facility/FacilityArtwork'
import FacilityColorPicker from '../components/facility/FacilityColorPicker'
import FacilityPhotoPicker from '../components/facility/FacilityPhotoPicker'
import FacilityScheduleEditor from '../components/facility/FacilityScheduleEditor'
import AmenityEquipmentEditor from '../components/facility/AmenityEquipmentEditor'
import Modal from '../components/ui/Modal'
import PageHeading from '../components/ui/PageHeading'
import useAsyncResource from '../hooks/useAsyncResource'
import { facilityService } from '../services/facilityService'
import { ownerService } from '../services/ownerService'
import { facilityColorForId } from '../utils/facilityAppearance'

function OwnerFacilitiesPage() {
  const loader = useCallback(() => ownerService.getFacilities(), [])
  const sportsLoader = useCallback(() => facilityService.getSports(), [])
  const amenitiesLoader = useCallback(() => facilityService.getAmenities(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const { data: sportData, isLoading: sportsLoading, error: sportsError } = useAsyncResource(sportsLoader)
  const { data: amenityData } = useAsyncResource(amenitiesLoader)
  const [selected, setSelected] = useState(null)
  const [name, setName] = useState('')
  const [sport, setSport] = useState('')
  const [rate, setRate] = useState('')
  const [courtCount, setCourtCount] = useState('1')
  const [image, setImage] = useState('')
  const [color, setColor] = useState('')
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isCropPending, setIsCropPending] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [isRemoving, setIsRemoving] = useState(false)
  const facilities = data ?? []
  const amenityOptions = (amenityData ?? []).map((amenity) => amenity.name)
  const [amenities, setAmenities] = useState([])
  const [equipmentCategories, setEquipmentCategories] = useState([])

  function openCreate() {
    setSelected('new')
    setIsCropPending(false)
    setName('')
    setSport(sportData?.[0]?.name ?? '')
    setRate('')
    setCourtCount('1')
    setImage('')
    setColor('#1d4ed8')
    setAmenities([])
    setEquipmentCategories([])
    setFormError('')
  }

  async function openEdit(facility) {
    let details = facility
    try {
      details = await facilityService.getFacilityById(facility.id)
    } catch (loadError) {
      setFormError(loadError instanceof Error ? loadError.message : 'Facility details could not be loaded.')
      return
    }
    setSelected(facility)
    setIsCropPending(false)
    setName(details.name)
    setSport(details.sport)
    setRate(String(details.hourlyRate ?? details.price.replace(/[^\d.]/g, '')))
    setCourtCount(String(details.courtCount ?? 1))
    setImage(details.image ?? '')
    setColor(details.color ?? facilityColorForId(facility.id))
    setAmenities(details.amenities ?? [])
    setEquipmentCategories(details.equipmentCategories ?? [])
    setFormError('')
  }

  async function saveFacility(event) {
    event.preventDefault()
    if (isCropPending) {
      setFormError('Apply the crop or cancel it before saving the facility.')
      return
    }
    const numericRate = Number(rate)
    const numericCourtCount = Number(courtCount)
    if (!name.trim() || !sport.trim() || !Number.isFinite(numericRate) || numericRate <= 0 ||
      !Number.isInteger(numericCourtCount) || numericCourtCount < 1 || numericCourtCount > 20) {
      setFormError('Enter a facility name, sport, valid rate, and a whole number of courts from 1 to 20.')
      return
    }
    setIsSaving(true)
    setFormError('')
    try {
      if (selected === 'new') {
        await ownerService.createFacility({
          name: name.trim(),
          sport: sport.trim(),
          hourlyRate: numericRate,
          courtCount: numericCourtCount,
          image: image || null,
          color,
          amenities,
          equipmentCategories,
          active: true,
        })
      } else {
      await ownerService.updateFacility(selected.id, {
        name: name.trim(),
        sport: sport.trim(),
        price: `₱${new Intl.NumberFormat('en-PH').format(numericRate)}/hr`,
        courtCount: numericCourtCount,
        image: image || null,
        color,
        amenities,
        equipmentCategories,
      })
      }
      setSelected(null)
      setIsCropPending(false)
      reload()
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Facility changes could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleListing(facility) {
    try {
      await ownerService.updateFacility(facility.id, { active: !facility.active })
      reload()
    } catch (updateError) {
      setFormError(updateError instanceof Error ? updateError.message : 'Listing status could not be updated.')
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
      await ownerService.removeFacility(removeTarget.id, removeReason.trim())
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading title="Facilities" description="Manage the information players see when they browse your venues." />
        <Button onClick={openCreate} disabled={sportsLoading || !sportData?.length}>Add facility</Button>
      </div>
      {sportsError ? <p role="alert" className="text-sm text-danger">Sport types could not be loaded. Reload the page and try again.</p> : null}
      {formError && !selected ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !facilities.length} emptyMessage="No facilities are assigned to your account." />
      {!isLoading && !error && facilities.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {facilities.map((facility) => (
            <Card key={facility.id} className="flex flex-col overflow-hidden p-0">
              <FacilityArtwork facility={facility} className="min-h-20" showStatus showEquipmentRental />
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted">Hourly rate</p>
                    <p className="mt-1 text-sm font-bold text-accent">{facility.price}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted">Courts / areas</p>
                    <p className="mt-1 text-sm font-semibold">{facility.courtCount ?? 1}</p>
                  </div>
                </div>
                <p className="text-xs text-success">{facility.availability} currently listed</p>
                <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3">
                  <Button variant="secondary" onClick={() => toggleListing(facility)} className="w-full whitespace-nowrap px-1.5 py-1.5 text-xs">
                    {facility.active ? 'Pause' : 'Activate'}
                  </Button>
                  <Button onClick={() => openEdit(facility)} className="w-full px-1.5 py-1.5 text-xs">Edit</Button>
                  <Button variant="danger" onClick={() => openRemove(facility)} className="w-full px-1.5 py-1.5 text-xs">Remove</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      <Modal open={Boolean(selected)} onClose={() => { setSelected(null); setIsCropPending(false) }} title={selected === 'new' ? 'Add Facility' : 'Edit Facility'} className="max-h-[90vh] overflow-y-auto">
        {selected ? (
          <form onSubmit={saveFacility} className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Facility name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Sport</span>
              <select required value={sport} disabled={sportsLoading || !sportData?.length} onChange={(event) => setSport(event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
                <option value="">Choose a sport</option>
                {(sportData ?? []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Rate per hour (₱)</span>
              <input type="number" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
            <FacilityPhotoPicker
              key={`facility-photo-${selected === 'new' ? 'new' : selected.id}`}
              value={image}
              color={color}
              disabled={isSaving}
              onChange={setImage}
              onCropPendingChange={(pending) => { setIsCropPending(pending); if (!pending) setFormError('') }}
            />
            <FacilityColorPicker value={color} disabled={isSaving} onChange={setColor} />
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Number of courts</span>
              <input type="number" min="1" max="20" step="1" value={courtCount} onChange={(event) => setCourtCount(event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
            </label>
            <AmenityEquipmentEditor
              amenities={amenities}
              amenityOptions={amenityOptions}
              equipmentCategories={equipmentCategories}
              disabled={isSaving}
              onAmenitiesChange={setAmenities}
              onEquipmentCategoriesChange={setEquipmentCategories}
            />
            {selected !== 'new' ? <FacilityScheduleEditor key={selected.id} facilityId={selected.id} /> : null}
            {isCropPending ? <p role="status" className="text-xs text-muted">Apply the crop to attach this photo, or cancel the crop to save without it.</p> : null}
            {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setSelected(null); setIsCropPending(false) }}>Cancel</Button>
              <Button type="submit" disabled={isSaving || isCropPending || !sportData?.length}>{isSaving ? 'Saving…' : selected === 'new' ? 'Save facility' : 'Save changes'}</Button>
            </div>
          </form>
        ) : null}
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
    </div>
  )
}

export default OwnerFacilitiesPage
