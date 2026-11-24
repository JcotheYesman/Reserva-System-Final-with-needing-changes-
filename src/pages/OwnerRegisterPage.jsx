import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import FacilityPhotoPicker from '../components/facility/FacilityPhotoPicker'
import AmenityEquipmentEditor from '../components/facility/AmenityEquipmentEditor'
import Button from '../components/ui/Button'
import { authService } from '../services/authService'
import { facilityService } from '../services/facilityService'
import { ownerService } from '../services/ownerService'

const guestDraftKey = 'reserva.ownerRegistrationDraft'

function createFacilityDraft(sport = '') {
  return {
    facilityName: '',
    sport,
    courtCount: '1',
    hourlyRate: '',
    openingTime: '08:00',
    closingTime: '22:00',
    amenities: [],
    equipmentCategories: [],
    photoNames: [],
    image: null,
  }
}

const initialDraft = {
  fullName: '',
  email: '',
  phone: '',
  businessName: '',
  businessAddress: '',
  businessContact: '',
  ownership: '',
  facilities: [createFacilityDraft()],
}

const steps = [
  { title: 'Owner account', description: 'Your contact details' },
  { title: 'Business details', description: 'Your facility business' },
  { title: 'Facilities', description: 'Create facility listings' },
  { title: 'Review', description: 'Check before submitting' },
]

function normalizeFacility(value = {}, defaultSport = '') {
  return {
    facilityName: String(value.facilityName ?? value.name ?? ''),
    sport: String(value.sport ?? defaultSport),
    courtCount: String(value.courtCount ?? 1),
    hourlyRate: String(value.hourlyRate ?? ''),
    openingTime: String(value.openingTime ?? '08:00'),
    closingTime: String(value.closingTime ?? '22:00'),
    amenities: Array.isArray(value.amenities) ? value.amenities : [],
    equipmentCategories: Array.isArray(value.equipmentCategories) ? value.equipmentCategories : [],
    photoNames: Array.isArray(value.photoNames) ? value.photoNames : [],
    image: typeof value.image === 'string' ? value.image : null,
  }
}

function normalizeDraft(value = {}, defaultSport = '') {
  const hasFacilityList = Array.isArray(value.facilities) && value.facilities.length > 0
  const hasLegacyFacility = ['facilityName', 'sport', 'courtCount', 'hourlyRate'].some((key) => key in value)
  const facilityValues = hasFacilityList
    ? value.facilities
    : value.facility && typeof value.facility === 'object'
      ? [value.facility]
      : hasLegacyFacility ? [value] : [createFacilityDraft(defaultSport)]
  const facilities = facilityValues.map((facility) => normalizeFacility(facility, defaultSport))
  const requestedIndex = Number(value.facilityIndex ?? 0)
  return {
    draft: { ...initialDraft, ...value, facilities },
    facilityIndex: Number.isInteger(requestedIndex) ? Math.max(0, Math.min(facilities.length - 1, requestedIndex)) : 0,
  }
}

function validateFacility(facility) {
  const errors = {}
  if (!facility?.facilityName?.trim()) errors.facilityName = 'Enter a name for this facility.'
  if (!facility?.sport) errors.sport = 'Choose a sport or facility type.'
  if (!Number.isInteger(Number(facility?.courtCount)) || Number(facility?.courtCount) < 1 || Number(facility?.courtCount) > 20) {
    errors.courtCount = 'Enter between 1 and 20 courts or playing areas.'
  }
  if (!Number.isFinite(Number(facility?.hourlyRate)) || Number(facility?.hourlyRate) < 1) errors.hourlyRate = 'Enter an hourly rate greater than zero.'
  if (!facility?.openingTime || !facility?.closingTime || facility.openingTime >= facility.closingTime) errors.hours = 'Closing time must be later than opening time.'
  return errors
}

function OwnerRegisterPage() {
  const navigate = useNavigate()
  const [accountUser, setAccountUser] = useState(null)
  const [draft, setDraft] = useState(initialDraft)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [step, setStep] = useState(0)
  const [facilityIndex, setFacilityIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [sportOptions, setSportOptions] = useState([])
  const [amenityOptions, setAmenityOptions] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [photoCropPending, setPhotoCropPending] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [needsChanges, setNeedsChanges] = useState(false)

  useEffect(() => {
    let current = true
    async function loadRegistration() {
      try {
        const [currentUser, sports, amenities] = await Promise.all([
          authService.getSession().catch(() => null),
          facilityService.getSports(),
          facilityService.getAmenities(),
        ])
        if (!current) return
        setAccountUser(currentUser)
        const sportNames = sports.map((sport) => sport.name)
        const amenityNames = amenities.map((amenity) => amenity.name)
        setSportOptions(sportNames)
        setAmenityOptions(amenityNames)

        if (currentUser?.role === 'Admin') {
          navigate('/admin', { replace: true })
          return
        }

        const application = currentUser ? await ownerService.getApplicationStatus() : null
        if (!current) return

        if (application && application.status !== 'Needs changes') {
          setIsSubmitted(true)
          navigate('/owner/application', { replace: true })
          return
        }

        if (currentUser?.role === 'Facility Owner' && !application) {
          navigate('/owner/dashboard', { replace: true })
          return
        }

        const savedDraft = currentUser
          ? await ownerService.getApplicationDraft()
          : readGuestDraft()
        if (!current) return
        if (application?.status === 'Needs changes') {
          setNeedsChanges(true)
          const applicationFacilities = Array.isArray(application.facilities) && application.facilities.length
            ? application.facilities
            : [application.facility ?? {}]
          const applicationDraft = {
            fullName: application.owner?.fullName ?? '',
            email: application.owner?.email ?? '',
            phone: application.owner?.phone ?? '',
            businessName: application.business?.name ?? '',
            businessAddress: application.business?.address ?? '',
            businessContact: application.business?.contact ?? '',
            ownership: application.business?.ownership ?? '',
            facilities: applicationFacilities.map((facility) => normalizeFacility(facility, sportNames[0] ?? '')),
          }
          const mergedDraft = { ...applicationDraft, ...(savedDraft ?? {}) }
          if (savedDraft && !Array.isArray(savedDraft.facilities) && ['facilityName', 'sport', 'courtCount', 'hourlyRate'].some((key) => key in savedDraft)) {
            mergedDraft.facilities = [normalizeFacility(savedDraft, sportNames[0] ?? ''), ...applicationDraft.facilities.slice(1)]
          }
          const restored = normalizeDraft(mergedDraft, sportNames[0] ?? '')
          setDraft(restored.draft)
          setFacilityIndex(restored.facilityIndex)
        } else if (savedDraft) {
          const restored = normalizeDraft({
            ...savedDraft,
            ...(currentUser ? {
              fullName: currentUser.name ?? savedDraft.fullName ?? '',
              email: currentUser.email ?? savedDraft.email ?? '',
              phone: currentUser.phone ?? savedDraft.phone ?? '',
            } : {}),
          }, sportNames[0] ?? '')
          setDraft(restored.draft)
          setFacilityIndex(restored.facilityIndex)
        } else if (sportNames.length) {
          setDraft((value) => ({
            ...value,
            ...(currentUser ? {
              fullName: currentUser.name ?? '',
              email: currentUser.email ?? '',
              phone: currentUser.phone ?? '',
            } : {}),
            facilities: [createFacilityDraft(sportNames[0])],
          }))
        }
        const savedStep = Number(savedDraft?.step)
        if (Number.isInteger(savedStep) && savedStep >= 0 && savedStep < steps.length) setStep(savedStep)
      } catch (loadError) {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Your saved application could not be loaded.')
      } finally {
        if (current) setIsLoading(false)
      }
    }
    loadRegistration()
    return () => {
      current = false
    }
  }, [navigate])

  const facilities = draft.facilities?.length ? draft.facilities : [createFacilityDraft(sportOptions[0] ?? '')]
  const activeFacility = facilities[facilityIndex] ?? facilities[0]

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: '' }))
    setError('')
  }

  const updateFacility = (field, value) => {
    setDraft((current) => {
      const currentFacilities = current.facilities?.length ? current.facilities : [createFacilityDraft(sportOptions[0] ?? '')]
      const nextFacilities = [...currentFacilities]
      nextFacilities[facilityIndex] = { ...nextFacilities[facilityIndex], [field]: value }
      return { ...current, facilities: nextFacilities }
    })
    setFieldErrors((current) => ({ ...current, [field]: '', hours: '' }))
    setError('')
  }

  async function persistDraft(nextDraft) {
    const { password: ignoredPassword, confirmPassword: ignoredConfirmation, ...safeDraft } = nextDraft
    void ignoredPassword
    void ignoredConfirmation
    if (accountUser) await ownerService.saveApplicationDraft(safeDraft)
    else window.sessionStorage.setItem(guestDraftKey, JSON.stringify(safeDraft))
  }

  function validateStep() {
    const errors = {}
    if (step === 0) {
      if (!draft.fullName.trim()) errors.fullName = 'Enter your full name.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Enter a valid email address.'
      if (!/^[+()\d\s-]{7,20}$/.test(draft.phone.trim())) errors.phone = 'Enter a valid phone number.'
      if (!needsChanges && password.length < 8) errors.password = 'Use at least 8 characters.'
      if (!needsChanges && password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.'
    }
    if (step === 1) {
      if (!draft.businessName.trim()) errors.businessName = 'Enter your business or facility name.'
      if (!draft.businessAddress.trim()) errors.businessAddress = 'Enter the full facility address.'
      if (!/^[+()\d\s-]{7,20}$/.test(draft.businessContact.trim())) errors.businessContact = 'Enter a valid business phone number.'
      if (!draft.ownership) errors.ownership = 'Select your relationship to this business.'
    }
    if (step === 2) {
      for (let index = 0; index < facilities.length; index += 1) {
        const facilityErrors = validateFacility(facilities[index])
        if (Object.keys(facilityErrors).length) {
          Object.assign(errors, facilityErrors)
          setFacilityIndex(index)
          break
        }
      }
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function saveDraft(nextStep, nextFacilityIndex = facilityIndex) {
    if (step === 2 && photoCropPending) {
      setError('Apply or cancel the facility photo crop before leaving this listing.')
      return
    }
    setError('')
    setIsSaving(true)
    try {
      await persistDraft({ ...draft, step: nextStep, facilityIndex: nextFacilityIndex })
      setFacilityIndex(nextFacilityIndex)
      setStep(nextStep)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Your progress could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  async function continueStep(event) {
    event.preventDefault()
    if (step === 2 && photoCropPending) {
      setError('Apply or cancel the facility photo crop before continuing.')
      return
    }
    if (!validateStep()) return
    await saveDraft(step + 1)
  }

  async function addFacility() {
    if (photoCropPending) {
      setError('Apply or cancel the facility photo crop before adding another listing.')
      return
    }
    if (facilities.length >= 20) {
      setError('You can add up to 20 facility listings to one application.')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      const nextFacilities = [...facilities, createFacilityDraft(activeFacility.sport || sportOptions[0] || '')]
      const nextIndex = nextFacilities.length - 1
      const nextDraft = { ...draft, facilities: nextFacilities, step: 2, facilityIndex: nextIndex }
      await persistDraft(nextDraft)
      setDraft(nextDraft)
      setFacilityIndex(nextIndex)
      setFieldErrors({})
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The new facility listing could not be added.')
    } finally {
      setIsSaving(false)
    }
  }

  function moveFacility(offset) {
    if (photoCropPending) return
    setFacilityIndex((current) => Math.min(facilities.length - 1, Math.max(0, current + offset)))
    setFieldErrors({})
    setError('')
  }

  async function submitApplication() {
    const invalidFacilityIndex = facilities.findIndex((facility) => Object.keys(validateFacility(facility)).length > 0)
    if (invalidFacilityIndex !== -1) {
      setFacilityIndex(invalidFacilityIndex)
      setFieldErrors(validateFacility(facilities[invalidFacilityIndex]))
      setStep(2)
      setError('Correct the highlighted facility details before submitting your application.')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      if (!needsChanges) {
        if (accountUser?.role !== 'Facility Owner') {
          const result = await ownerService.registerOwnerAccount({
            fullName: draft.fullName,
            email: draft.email,
            phone: draft.phone,
            password,
          })
          setAccountUser(result.owner)
        }
      }
      const applicationFacilities = facilities.map(({ facilityName, ...facility }) => ({
        ...facility,
        name: facilityName.trim(),
        courtCount: Number(facility.courtCount),
        hourlyRate: Number(facility.hourlyRate),
        amenities: [...facility.amenities],
        photoNames: [...facility.photoNames],
      }))
      const firstFacility = applicationFacilities[0]
      const { facilities: ignoredFacilities, ...applicationDraft } = draft
      void ignoredFacilities
      const application = await ownerService.submitApplication({
        owner: {
          fullName: applicationDraft.fullName.trim(),
          email: applicationDraft.email.trim(),
          phone: applicationDraft.phone.trim(),
        },
        business: {
          name: applicationDraft.businessName.trim(),
          address: applicationDraft.businessAddress.trim(),
          contact: applicationDraft.businessContact.trim(),
          ownership: applicationDraft.ownership,
        },
        facility: firstFacility,
        facilities: applicationFacilities,
      })
      window.sessionStorage.removeItem(guestDraftKey)
      setIsSubmitted(true)
      navigate('/owner/application', { state: { application } })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your application could not be submitted.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isSubmitted) return <Navigate to="/owner/application" replace />

  return (
    <main className="min-h-screen bg-bg px-3 py-4 text-text sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-3">
          <BrandLogo to="/guest" className="brand-logo--large" />
          <Link to="/guest" className="text-xs font-semibold text-muted hover:text-text">Back to Guestpage</Link>
        </header>
        <div className="mx-auto mt-8 max-w-3xl">
          <p className="text-center text-xs font-bold uppercase tracking-[.18em] text-accent">Facility partner onboarding</p>
          <h1 className="mt-2 text-center text-2xl font-bold sm:text-3xl">List your facility on RESERVA</h1>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm leading-6 text-muted">
            Create your owner account, add your business details, then submit your facility listings for review.
          </p>

          <nav aria-label="Application steps" className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {steps.map((item, index) => (
              <div
                key={item.title}
                aria-current={step === index ? 'step' : undefined}
                className={`rounded-md border px-3 py-2 ${step === index ? 'border-accent bg-accent/10' : 'border-border bg-surface'}`}
              >
                <p className={`text-xs font-bold ${step === index ? 'text-accent' : index < step ? 'text-success' : 'text-muted'}`}>
                  <span className="mr-1.5">{index < step ? '✓' : `0${index + 1}`}</span>{item.title}
                </p>
                <p className="mt-1 hidden text-[10px] text-muted sm:block">{item.description}</p>
              </div>
            ))}
          </nav>

          <section className="mt-4 rounded-card border border-border bg-surface p-4 sm:p-6">
            {isLoading ? <p role="status" className="py-10 text-center text-sm text-muted">Loading your saved progress…</p> : null}
            {!isLoading && step === 0 ? (
              <form onSubmit={continueStep} className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold">{needsChanges ? 'Update your owner details' : 'Create your owner account'}</h2>
                  <p className="mt-1 text-xs text-muted">{needsChanges ? 'Update the account details requested by the reviewer.' : 'These details are for your RESERVA sign-in and account contact.'}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OwnerInput label="Full name" value={draft.fullName} onChange={(value) => updateDraft('fullName', value)} error={fieldErrors.fullName} autoComplete="name" />
                  <OwnerInput label="Email address" type="email" value={draft.email} onChange={(value) => updateDraft('email', value)} error={fieldErrors.email} autoComplete="email" />
                  <OwnerInput label="Phone number" type="tel" value={draft.phone} onChange={(value) => updateDraft('phone', value)} error={fieldErrors.phone} autoComplete="tel" />
                  <span className="hidden sm:block" />
                  {!needsChanges ? <OwnerInput label="Password" type="password" value={password} onChange={setPassword} error={fieldErrors.password} autoComplete="new-password" showPassword={showPassword} onTogglePassword={() => setShowPassword((visible) => !visible)} /> : null}
                  {!needsChanges ? <OwnerInput label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} error={fieldErrors.confirmPassword} autoComplete="new-password" showPassword={showConfirmPassword} onTogglePassword={() => setShowConfirmPassword((visible) => !visible)} /> : null}
                </div>
                {!needsChanges ? <p className="rounded border border-info/30 bg-info/10 px-3 py-2 text-xs leading-5 text-muted">
                  Passwords are never included in saved drafts. If you leave and return before submitting, you’ll need to enter it again.
                </p> : null}
                <StepActions isSaving={isSaving} />
              </form>
            ) : null}
            {!isLoading && step === 1 ? (
              <form onSubmit={continueStep} className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold">Tell us about your business</h2>
                  <p className="mt-1 text-xs text-muted">Use the address where customers will visit your facility.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OwnerInput label="Business or facility business name" value={draft.businessName} onChange={(value) => updateDraft('businessName', value)} error={fieldErrors.businessName} />
                  <OwnerInput label="Business contact number" type="tel" value={draft.businessContact} onChange={(value) => updateDraft('businessContact', value)} error={fieldErrors.businessContact} />
                  <OwnerInput label="Full facility address" value={draft.businessAddress} onChange={(value) => updateDraft('businessAddress', value)} error={fieldErrors.businessAddress} className="sm:col-span-2" />
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-medium text-muted">Your relationship to the business</span>
                    <select value={draft.ownership} onChange={(event) => updateDraft('ownership', event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
                      <option value="">Choose one</option>
                      <option value="Owner">I am the owner</option>
                      <option value="Authorized manager">I am an authorized manager</option>
                      <option value="Representative">I represent the business</option>
                    </select>
                    {fieldErrors.ownership ? <FieldError>{fieldErrors.ownership}</FieldError> : null}
                  </label>
                </div>
                <p className="rounded border border-border bg-bg px-3 py-2 text-xs leading-5 text-muted">
                  Verification requirements will be shown before submission if additional business information is needed.
                </p>
                <StepActions onBack={() => saveDraft(0)} isSaving={isSaving} />
              </form>
            ) : null}
            {!isLoading && step === 2 ? (
              <form onSubmit={continueStep} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{facilityIndex === 0 ? 'Create your first facility listing' : `Create facility listing ${facilityIndex + 1}`}</h2>
                    <p className="mt-1 text-xs text-muted">Add each venue you want reviewed with this application.</p>
                  </div>
                  {facilities.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" className="px-2.5" disabled={isSaving || photoCropPending || facilityIndex === 0} onClick={() => moveFacility(-1)} aria-label="Previous facility">&#8592;</Button>
                      <span className="min-w-20 text-center text-xs font-semibold text-muted">{facilityIndex + 1} of {facilities.length}</span>
                      <Button type="button" variant="secondary" className="px-2.5" disabled={isSaving || photoCropPending || facilityIndex >= facilities.length - 1} onClick={() => moveFacility(1)} aria-label="Next facility">&#8594;</Button>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OwnerInput label="Facility listing name" value={activeFacility.facilityName} onChange={(value) => updateFacility('facilityName', value)} error={fieldErrors.facilityName} />
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-muted">Sport or facility type</span>
                    <select required value={activeFacility.sport} onChange={(event) => updateFacility('sport', event.target.value)} disabled={!sportOptions.length} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
                      <option value="">Choose a sport</option>
                      {sportOptions.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
                    </select>
                    {fieldErrors.sport ? <FieldError>{fieldErrors.sport}</FieldError> : null}
                  </label>
                  <OwnerInput label="Number of courts / playing areas" type="number" min="1" max="20" value={activeFacility.courtCount} onChange={(value) => updateFacility('courtCount', value)} error={fieldErrors.courtCount} />
                  <OwnerInput label="Hourly rate (₱)" type="number" min="1" value={activeFacility.hourlyRate} onChange={(value) => updateFacility('hourlyRate', value)} error={fieldErrors.hourlyRate} />
                  <OwnerInput label="Opening time" type="time" value={activeFacility.openingTime} onChange={(value) => updateFacility('openingTime', value)} />
                  <OwnerInput label="Closing time" type="time" value={activeFacility.closingTime} onChange={(value) => updateFacility('closingTime', value)} />
                </div>
                {fieldErrors.hours ? <FieldError>{fieldErrors.hours}</FieldError> : null}
                <AmenityEquipmentEditor
                  amenities={activeFacility.amenities}
                  amenityOptions={amenityOptions}
                  equipmentCategories={activeFacility.equipmentCategories}
                  disabled={isSaving}
                  onAmenitiesChange={(amenities) => updateFacility('amenities', amenities)}
                  onEquipmentCategoriesChange={(equipmentCategories) => updateFacility('equipmentCategories', equipmentCategories)}
                />
                <FacilityPhotoPicker
                  key={`application-facility-photo-${facilityIndex}`}
                  value={activeFacility.image}
                  onChange={(image) => updateFacility('image', image || null)}
                  onCropPendingChange={setPhotoCropPending}
                  disabled={isSaving}
                />
                <StepActions
                  onBack={() => saveDraft(1)}
                  isSaving={isSaving}
                  beforeSubmit={<Button type="button" variant="secondary" disabled={isSaving || photoCropPending || facilities.length >= 20} onClick={addFacility}>Add Facility</Button>}
                  progress={<FacilityProgress current={facilityIndex} count={facilities.length} />}
                />
              </form>
            ) : null}
            {!isLoading && step === 3 ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold">Review your application</h2>
                  <p className="mt-1 text-xs text-muted">Check the details before sending them for review.</p>
                </div>
                <ReviewSection title="Owner account" onEdit={() => saveDraft(0)} rows={[
                  ['Name', draft.fullName],
                  ['Email', draft.email],
                  ['Phone', draft.phone],
                ]} />
                <ReviewSection title="Business" onEdit={() => saveDraft(1)} rows={[
                  ['Business name', draft.businessName],
                  ['Address', draft.businessAddress],
                  ['Contact', draft.businessContact],
                  ['Relationship', draft.ownership],
                ]} />
                {facilities.map((facility, index) => (
                  <ReviewSection key={`facility-${index}`} title={`Facility ${index + 1}: ${facility.facilityName || 'Listing details'}`} onEdit={() => saveDraft(2, index)} rows={[
                    ['Sport', facility.sport],
                    ['Courts / areas', facility.courtCount],
                    ['Hourly rate', `₱${new Intl.NumberFormat('en-PH').format(Number(facility.hourlyRate))}/hr`],
                    ['Operating hours', `${facility.openingTime}–${facility.closingTime}`],
                    ['Amenities', facility.amenities.length ? facility.amenities.join(', ') : 'None selected'],
                    ['Equipment items', facility.amenities.some((amenity) => amenity.toLowerCase() === 'equipment rental')
                      ? facility.equipmentCategories.reduce((total, category) => total + category.items.length, 0)
                      : 'Equipment rental not offered'],
                    ['Facility photo', facility.image ? 'Added' : 'Not added'],
                  ]} />
                ))}
                <p className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-xs leading-5 text-muted">
                  Submitting creates a pending application. Your owner dashboard and booking management will stay unavailable until the facility listing is approved.
                </p>
                {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
                <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
                  <Button variant="secondary" disabled={isSaving} onClick={() => saveDraft(2)}>Back</Button>
                  <Button disabled={isSaving} onClick={submitApplication}>{isSaving ? 'Submitting…' : 'Submit for review'}</Button>
                </div>
              </div>
            ) : null}
            {error && !isLoading && step < 3 ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
          </section>
          <p className="mt-4 text-center text-xs text-muted">
            Already have an owner application? <Link to="/owner/application" className="font-semibold text-accent hover:underline">Check its status</Link>
          </p>
        </div>
      </div>
    </main>
  )
}

function OwnerInput({ label, value, onChange, error, className = '', showPassword = false, onTogglePassword, ...props }) {
  const id = `owner-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const errorId = `${id}-error`
  const inputType = props.type === 'password' && showPassword ? 'text' : props.type
  const input = (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errorId : undefined}
      className={`h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text ${props.type === 'password' ? 'pr-10' : ''}`}
      {...props}
      type={inputType}
    />
  )
  if (props.type === 'password') {
    return (
      <div className={`block ${className}`}>
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
        <div className="relative">
          {input}
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={`${showPassword ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {showPassword ? <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.5 0 9 7 9 7a14.7 14.7 0 0 1-3 3.7M6.2 6.2C3.8 7.8 3 12 3 12s3.5 7 9 7a9.7 9.7 0 0 0 3.1-.5" /></> : <><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" /><circle cx="12" cy="12" r="2.5" /></>}
            </svg>
          </button>
        </div>
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </div>
    )
  }
  return (
    <label htmlFor={id} className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {input}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </label>
  )
}

function FieldError({ children, id }) {
  return <span id={id} role="alert" className="mt-1 block text-xs text-danger">{children}</span>
}

function StepActions({ onBack, isSaving, beforeSubmit, progress }) {
  return (
    <div className="border-t border-border pt-4">
      {progress ? <div className="mb-3">{progress}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack ? (
          <Button variant="secondary" type="button" disabled={isSaving} onClick={onBack}>Back</Button>
        ) : <span />}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {beforeSubmit}
          <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save and continue'}</Button>
        </div>
      </div>
    </div>
  )
}

function FacilityProgress({ current, count }) {
  return (
    <div className="text-center" aria-live="polite" aria-label={`Editing facility ${current + 1} of ${count}`}>
      <div className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className={`h-2 w-2 rounded-full ${index === current ? 'bg-accent' : 'bg-border'}`} />
        ))}
      </div>
      <p className="mt-1.5 text-[10px] font-medium text-muted">Editing facility {current + 1} of {count}</p>
    </div>
  )
}

function ReviewSection({ title, rows, onEdit }) {
  return (
    <section className="rounded-md border border-border bg-bg px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold">{title}</h3>
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-info hover:underline">Edit</button>
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-start justify-between gap-3 text-xs">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-text [overflow-wrap:anywhere]">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function readGuestDraft() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(guestDraftKey) ?? 'null')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export default OwnerRegisterPage
