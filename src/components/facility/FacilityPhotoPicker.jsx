import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'

const MAX_INPUT_SIZE = 20 * 1024 * 1024
const MAX_OUTPUT_SIZE = 400_000
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const CROP_ASPECT = 16 / 9

function cropPreviewStyle(imageSize, zoom, positionX, positionY) {
  if (!imageSize?.width || !imageSize?.height) return null
  let cropWidth = imageSize.width
  let cropHeight = imageSize.height
  if (cropWidth / cropHeight > CROP_ASPECT) cropWidth = cropHeight * CROP_ASPECT
  else cropHeight = cropWidth / CROP_ASPECT
  cropWidth /= zoom
  cropHeight /= zoom
  const cropX = (imageSize.width - cropWidth) * (positionX / 100)
  const cropY = (imageSize.height - cropHeight) * (positionY / 100)
  return {
    width: `${(imageSize.width / cropWidth) * 100}%`,
    height: `${(imageSize.height / cropHeight) * 100}%`,
    left: `${(-cropX / cropWidth) * 100}%`,
    top: `${(-cropY / cropHeight) * 100}%`,
    maxWidth: 'none',
  }
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('The facility photo could not be read.'))
    reader.readAsDataURL(blob)
  })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function cropFacilityPhoto(file, zoom, positionX, positionY) {
  const bitmap = await createImageBitmap(file)
  try {
    const drawCrop = (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not prepare the facility photo.')
      const aspect = width / height
      let cropWidth = bitmap.width
      let cropHeight = bitmap.height
      if (cropWidth / cropHeight > aspect) cropWidth = cropHeight * aspect
      else cropHeight = cropWidth / aspect
      cropWidth /= zoom
      cropHeight /= zoom
      const x = (bitmap.width - cropWidth) * (positionX / 100)
      const y = (bitmap.height - cropHeight) * (positionY / 100)
      context.drawImage(bitmap, x, y, cropWidth, cropHeight, 0, 0, width, height)
      return canvas
    }

    let blob = await canvasBlob(drawCrop(1200, 675), 'image/webp', 0.82)
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(drawCrop(1200, 675), 'image/jpeg', 0.82)
    if (!blob || blob.size > MAX_OUTPUT_SIZE) blob = await canvasBlob(drawCrop(960, 540), 'image/webp', 0.72)
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(drawCrop(960, 540), 'image/jpeg', 0.72)
    if (!blob || blob.size > MAX_OUTPUT_SIZE) throw new Error('This photo is still too large after cropping. Choose another photo.')
    return await dataUrl(blob)
  } finally {
    bitmap.close()
  }
}

function FacilityPhotoPicker({ value, onChange, color, disabled = false, onCropPendingChange = () => {} }) {
  const fileInput = useRef(null)
  const [cropFile, setCropFile] = useState(null)
  const [cropUrl, setCropUrl] = useState('')
  const [zoom, setZoom] = useState(1)
  const [positionX, setPositionX] = useState(50)
  const [positionY, setPositionY] = useState(50)
  const [imageSize, setImageSize] = useState(null)
  const [appliedCrop, setAppliedCrop] = useState(null)
  const [cropPending, setCropPending] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (cropUrl) URL.revokeObjectURL(cropUrl)
  }, [cropUrl])

  function chooseFile(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Choose a JPG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_INPUT_SIZE) {
      setError('Choose an image smaller than 20 MB.')
      return
    }
    setError('')
    setZoom(1)
    setPositionX(50)
    setPositionY(50)
    setImageSize(null)
    setAppliedCrop(null)
    setCropPending(true)
    setCropFile(file)
    setCropUrl(URL.createObjectURL(file))
    onCropPendingChange(true)
  }

  function discardCrop() {
    setCropFile(null)
    setCropUrl('')
    setImageSize(null)
    setAppliedCrop(null)
    setCropPending(false)
    setError('')
    onCropPendingChange(false)
  }

  function cancelCrop() {
    if (appliedCrop) {
      setZoom(appliedCrop.zoom)
      setPositionX(appliedCrop.positionX)
      setPositionY(appliedCrop.positionY)
      setCropPending(false)
      setError('')
      onCropPendingChange(false)
      return
    }
    discardCrop()
  }

  function updateCrop(key, nextValue) {
    const next = { zoom, positionX, positionY, [key]: nextValue }
    if (key !== 'zoom' && next.zoom === 1) next.zoom = 1.1
    setZoom(next.zoom)
    setPositionX(next.positionX)
    setPositionY(next.positionY)
    const pending = !appliedCrop || next.zoom !== appliedCrop.zoom ||
      next.positionX !== appliedCrop.positionX || next.positionY !== appliedCrop.positionY
    setCropPending(pending)
    onCropPendingChange(pending)
  }

  async function applyCrop() {
    if (!cropFile) return
    setIsApplying(true)
    setError('')
    try {
      onChange(await cropFacilityPhoto(cropFile, zoom, positionX, positionY))
      setAppliedCrop({ zoom, positionX, positionY })
      setCropPending(false)
      onCropPendingChange(false)
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'The facility photo could not be cropped.')
    } finally {
      setIsApplying(false)
    }
  }

  const previewStyle = cropPreviewStyle(imageSize, zoom, positionX, positionY)

  return (
    <section className="space-y-3 rounded-md border border-border bg-bg p-3" aria-label="Facility photo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-text">Facility photo</p>
          <p className="mt-1 text-[10px] text-muted">Crop and position the 16:9 image players will see.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} className="sr-only" tabIndex={-1} />
          <Button type="button" variant="secondary" disabled={disabled || isApplying} onClick={() => fileInput.current?.click()} className="px-2 py-1.5 text-xs">
            {value ? 'Change photo' : 'Add photo'}
          </Button>
          {value ? <Button type="button" variant="ghost" disabled={disabled || isApplying} onClick={() => { onChange(''); discardCrop() }} className="px-2 py-1.5 text-xs">Remove</Button> : null}
        </div>
      </div>
      <div className="relative aspect-video overflow-hidden rounded border border-border" style={{ backgroundColor: color || '#475569' }}>
        {cropUrl ? (
          <img
            src={cropUrl}
            alt="Crop preview"
            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            className="absolute"
            style={previewStyle ?? { inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : value ? <img src={value} alt="Current facility photo" className="h-full w-full object-cover" /> : (
          <div className="grid h-full place-items-center text-xs font-semibold text-white/90">Color card preview</div>
        )}
        {cropUrl ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/40" /> : null}
      </div>
      {cropUrl ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-[10px] text-muted">Zoom
            <input aria-label="Photo zoom" type="range" min="1" max="2.5" step="0.05" value={zoom} disabled={isApplying} onChange={(event) => updateCrop('zoom', Number(event.target.value))} className="mt-1 block w-full accent-accent" />
          </label>
          <label className="text-[10px] text-muted">Horizontal position
            <input aria-label="Photo horizontal position" type="range" min="0" max="100" value={positionX} disabled={isApplying} onChange={(event) => updateCrop('positionX', Number(event.target.value))} className="mt-1 block w-full accent-accent" />
          </label>
          <label className="text-[10px] text-muted">Vertical position
            <input aria-label="Photo vertical position" type="range" min="0" max="100" value={positionY} disabled={isApplying} onChange={(event) => updateCrop('positionY', Number(event.target.value))} className="mt-1 block w-full accent-accent" />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button type="button" variant="secondary" disabled={isApplying} onClick={cancelCrop} className="px-2 py-1.5 text-xs">Cancel crop</Button>
            <Button type="button" disabled={isApplying || !cropPending} onClick={applyCrop} className="px-2 py-1.5 text-xs">{isApplying ? 'Cropping…' : 'Apply and use photo'}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </section>
  )
}

export default FacilityPhotoPicker
