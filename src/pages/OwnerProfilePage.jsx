import { useCallback, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import ProfilePictureCropModal from '../components/ProfilePictureCropModal'
import PageHeading from '../components/ui/PageHeading'
import useAsyncResource from '../hooks/useAsyncResource'
import { ownerService } from '../services/ownerService'

function normalizeProfile(value) {
  if (!value || typeof value !== 'object') return null
  return {
    ...value,
    firstName: typeof value.firstName === 'string' ? value.firstName : '',
    lastName: typeof value.lastName === 'string' ? value.lastName : '',
    email: typeof value.email === 'string' ? value.email : '',
    phone: typeof value.phone === 'string' ? value.phone : '',
    address: typeof value.address === 'string' ? value.address : '',
    status: typeof value.status === 'string' ? value.status : 'Active',
    profilePicture: typeof value.profilePicture === 'string' ? value.profilePicture : null,
  }
}

function OwnerProfilePage({ adminMode = false }) {
  const loader = useCallback(() => ownerService.getProfile(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pictureWasSaved, setPictureWasSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCropOpen, setIsCropOpen] = useState(false)
  const [savedPicture, setSavedPicture] = useState(undefined)
  const profile = normalizeProfile(form ?? data)

  function updateField(field, value) {
    setForm((current) => ({ ...(normalizeProfile(current ?? data) ?? {}), [field]: value }))
    setSaved(false)
    setPictureWasSaved(false)
    setFormError('')
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!profile.firstName.trim() || !profile.lastName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
      setFormError('Enter your first name, last name, and a valid email address.')
      setSaved(false)
      return
    }
    setIsSaving(true)
    setFormError('')
    setSaved(false)
    setPictureWasSaved(false)
    try {
      const previousPicture = savedPicture === undefined ? (data?.profilePicture ?? null) : savedPicture
      const updatedProfile = await ownerService.saveProfile(profile)
      setSavedPicture(updatedProfile.profilePicture ?? null)
      setForm(updatedProfile)
      setPictureWasSaved((profile.profilePicture ?? null) !== previousPicture)
      setSaved(true)
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : `Your ${adminMode ? 'admin' : 'owner'} profile could not be saved.`)
    } finally {
      setIsSaving(false)
    }
  }

  const initials = [profile?.firstName, profile?.lastName]
    .map((part) => part?.trim()?.[0] ?? '')
    .join('')
    .toUpperCase()
  const memberSince = profile?.memberSince ? new Date(profile.memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : 'Date unavailable'

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeading
        title={adminMode ? 'Admin Profile' : 'Owner Profile'}
        description={adminMode ? 'Manage your administrator account details.' : 'Manage your facility owner account details.'}
      />
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {profile ? (
        <form onSubmit={saveProfile} className="grid items-start gap-4 lg:grid-cols-[230px_1fr]">
          <Card className="flex flex-col items-center text-center">
            <div className={`grid h-24 w-24 place-items-center overflow-hidden rounded-full border-2 text-2xl font-bold ${adminMode ? 'border-info bg-info/15 text-info' : 'border-accent bg-accent/15 text-accent'}`}>
              {profile.profilePicture ? (
                <img src={profile.profilePicture} alt={`${profile.firstName} ${profile.lastName}'s profile`} className="h-full w-full object-cover" />
              ) : initials}
            </div>
            <h2 className="mt-3 text-base font-bold">{[profile.firstName, profile.lastName].filter(Boolean).join(' ')}</h2>
            <span className="mt-2 rounded bg-success/15 px-2.5 py-1 text-xs font-bold text-success">
              {profile.status === 'Active' ? 'Active' : profile.status}
            </span>
            <p className="mt-3 text-xs text-muted">Member since {memberSince}</p>
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={() => setIsCropOpen(true)}
              className="mt-4"
            >
              Change Photo
            </Button>
          </Card>

          <Card>
            <h2 className="border-b border-border pb-3 text-sm font-bold">{adminMode ? 'Administrator Information' : 'Owner Information'}</h2>
            <div className="grid gap-3 py-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">First Name</span>
                <input required value={profile.firstName} onChange={(event) => updateField('firstName', event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Last Name</span>
                <input required value={profile.lastName} onChange={(event) => updateField('lastName', event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-muted">Email Address</span>
                <input type="email" required value={profile.email} onChange={(event) => updateField('email', event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Phone Number</span>
                <input type="tel" value={profile.phone ?? ''} onChange={(event) => updateField('phone', event.target.value)} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Address</span>
                <input value={profile.address ?? ''} onChange={(event) => updateField('address', event.target.value)} maxLength={500} className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text" />
              </label>
            </div>
            {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
            {saved ? (
              <p role="status" className="mt-3 text-sm text-success">
                {pictureWasSaved ? 'Profile picture updated successfully. ' : ''}Owner profile changes saved.
              </p>
            ) : null}
            <div className="mt-4 border-t border-border pt-4">
              <Button type="submit" variant={adminMode ? 'info' : 'primary'} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          </Card>
        </form>
      ) : null}
      <ProfilePictureCropModal
        open={isCropOpen}
        onClose={() => setIsCropOpen(false)}
        onApply={(picture) => {
          updateField('profilePicture', picture)
        }}
      />
    </div>
  )
}

export default OwnerProfilePage
