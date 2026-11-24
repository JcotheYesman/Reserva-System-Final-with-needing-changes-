import { useState } from 'react'
import Modal from '../ui/Modal'

function DisputeEvidenceGallery({ items = [], title = 'Attachments' }) {
  const [selected, setSelected] = useState(null)
  if (!items.length) return <p className="mt-2 text-xs text-muted">No attachments were uploaded.</p>
  return (
    <>
      <div className="mt-3 space-y-2">
        <h4 className="text-xs font-semibold">{title} ({items.length})</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelected(item)} className="rounded-md border border-border bg-bg p-2 text-left hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent">
              <img src={item.data} alt={item.description || item.name || title} className="max-h-52 w-full rounded object-contain" />
              {item.description ? <p className="mt-2 text-xs text-text">{item.description}</p> : null}
              <p className="mt-1 truncate text-[10px] text-muted">{item.name || 'Uploaded image'} · {item.createdAt ? new Date(item.createdAt).toLocaleString('en-PH') : 'Preview'}</p>
              <span className="mt-1 block text-[10px] font-semibold text-accent">View full image</span>
            </button>
          ))}
        </div>
      </div>
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.description || selected?.name || title} className="max-h-[95vh] overflow-y-auto sm:max-w-5xl">
        {selected ? <div className="space-y-2">
          <img src={selected.data} alt={selected.description || selected.name || title} className="mx-auto max-h-[75vh] max-w-full rounded object-contain" />
          {selected.description ? <p className="text-sm text-text">{selected.description}</p> : null}
          <p className="text-xs text-muted">{selected.name || 'Uploaded image'}{selected.createdAt ? ` · ${new Date(selected.createdAt).toLocaleString('en-PH')}` : ''}</p>
        </div> : null}
      </Modal>
    </>
  )
}

export default DisputeEvidenceGallery
