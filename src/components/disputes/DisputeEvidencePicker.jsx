import { useState } from 'react'
import Button from '../ui/Button'
import { prepareDisputeEvidence } from '../../utils/disputeEvidence'

function DisputeEvidencePicker({ items, onChange, disabled = false }) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  async function addFiles(event) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setProcessing(true)
    setError('')
    try {
      const prepared = []
      for (const file of files) prepared.push(await prepareDisputeEvidence(file))
      onChange([...items, ...prepared])
    } catch (prepareError) {
      setError(prepareError.message || 'One or more images could not be prepared.')
    } finally {
      setProcessing(false)
    }
  }

  function updateItem(id, patch) {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-text">Attachments / proof (optional)</p>
          <p className="mt-1 text-[11px] text-muted">Add as many photos as needed. Each photo can have a short description.</p>
        </div>
        <label className={`inline-flex cursor-pointer items-center rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:brightness-110 ${disabled || processing ? 'pointer-events-none opacity-50' : ''}`}>
          {processing ? 'Preparing photos…' : 'Add photos'}
          <input className="sr-only" type="file" accept="image/*" multiple disabled={disabled || processing} onChange={addFiles} />
        </label>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {items.length ? <div className="max-h-72 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[5rem_1fr_auto]">
            <img src={item.data} alt={item.name || 'Selected proof'} className="h-20 w-20 rounded border border-border object-cover" />
            <div className="min-w-0 space-y-1">
              <p className="truncate text-[11px] text-muted">{item.name}{item.uploaded ? ' · Uploaded' : ''}</p>
              <input
                value={item.description}
                maxLength={200}
                disabled={disabled || item.uploaded}
                onChange={(event) => updateItem(item.id, { description: event.target.value })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs text-text"
                placeholder="Short description"
              />
            </div>
            <Button type="button" variant="secondary" disabled={disabled || item.uploaded} className="px-2 py-1.5 text-xs" onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}>Remove</Button>
          </div>
        ))}
      </div> : null}
    </div>
  )
}

export default DisputeEvidencePicker
