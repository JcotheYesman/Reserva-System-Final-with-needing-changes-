import { useEffect, useRef, useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { acceptedProfilePictureTypes, resizeProfilePicture } from '../utils/resizeProfilePicture'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const clamp = (value) => Math.min(100, Math.max(0, value))

function ProfilePictureCropModal({ open, onClose, onApply }) {
  const [file, setFile] = useState(null)
  const [imageUrl, setImageUrl] = useState('')
  const [dimensions, setDimensions] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [positionX, setPositionX] = useState(50)
  const [positionY, setPositionY] = useState(50)
  const [error, setError] = useState('')
  const [isApplying, setIsApplying] = useState(false)
  const uploadInput = useRef(null)
  const dragStart = useRef(null)

  useEffect(() => {
    if (!imageUrl) return undefined
    return () => URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  function resetPreview() {
    dragStart.current = null
    setFile(null)
    setImageUrl('')
    setDimensions(null)
    setZoom(1)
    setPositionX(50)
    setPositionY(50)
    setError('')
  }

  function close() {
    if (isApplying) return
    resetPreview()
    onClose()
  }

  function chooseFile(event) {
    const input = event.currentTarget
    const selectedFile = input.files?.[0]
    input.value = ''
    if (!selectedFile) return
    if (!acceptedProfilePictureTypes.includes(selectedFile.type)) {
      setError('Choose a PNG, JPEG, or WebP image.')
      return
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('Choose an image smaller than 20 MB.')
      return
    }

    const nextUrl = URL.createObjectURL(selectedFile)
    setFile(selectedFile)
    setImageUrl(nextUrl)
    setDimensions(null)
    setZoom(1)
    setPositionX(50)
    setPositionY(50)
    setError('')
  }

  function handleImageLoad(event) {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget
    if (!width || !height) {
      setError('The selected image could not be loaded.')
      return
    }
    setDimensions({ width, height })
  }

  function startDrag(event) {
    if (!dimensions || isApplying) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = event.currentTarget.getBoundingClientRect()
    const minSide = Math.min(dimensions.width, dimensions.height)
    dragStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      positionX,
      positionY,
      overflowX: bounds.width * Math.max(0, (dimensions.width / minSide) * zoom - 1),
      overflowY: bounds.height * Math.max(0, (dimensions.height / minSide) * zoom - 1),
    }
  }

  function moveDrag(event) {
    const start = dragStart.current
    if (!start || start.pointerId !== event.pointerId) return
    if (start.overflowX > 0) setPositionX(clamp(start.positionX - ((event.clientX - start.x) / start.overflowX) * 100))
    if (start.overflowY > 0) setPositionY(clamp(start.positionY - ((event.clientY - start.y) / start.overflowY) * 100))
  }

  function stopDrag(event) {
    if (dragStart.current?.pointerId !== event.pointerId) return
    dragStart.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  async function applyCrop() {
    if (!file || !dimensions || isApplying) return
    setIsApplying(true)
    setError('')
    try {
      const picture = await resizeProfilePicture(file, { zoom, positionX, positionY })
      onApply(picture)
      resetPreview()
      onClose()
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'The cropped picture could not be prepared.')
    } finally {
      setIsApplying(false)
    }
  }

  const minSide = dimensions ? Math.min(dimensions.width, dimensions.height) : 1
  const widthRatio = dimensions ? dimensions.width / minSide : 1
  const heightRatio = dimensions ? dimensions.height / minSide : 1
  const canMoveX = widthRatio * zoom > 1.001
  const canMoveY = heightRatio * zoom > 1.001
  const imageStyle = {
    width: `${widthRatio * zoom * 100}%`,
    height: `${heightRatio * zoom * 100}%`,
    left: `${-(widthRatio * zoom - 1) * positionX}%`,
    top: `${-(heightRatio * zoom - 1) * positionY}%`,
  }

  return (
    <Modal open={open} onClose={close} title="Crop profile picture" className="max-h-[92vh] max-w-2xl overflow-y-auto">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Choose an image, then zoom or drag it to frame your picture.</p>
          <input
            ref={uploadInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={chooseFile}
            className="sr-only"
            tabIndex={-1}
          />
          <Button type="button" variant="secondary" disabled={isApplying} onClick={() => uploadInput.current?.click()}>
            {file ? 'Choose another image' : 'Upload image'}
          </Button>
        </div>

        {imageUrl ? (
          <div className="grid items-center justify-items-center gap-5 rounded-lg border border-border bg-bg p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col items-center gap-2">
              <div
                role="group"
                aria-label="Profile picture crop area. Drag the image to reposition it."
                className={`relative aspect-square w-64 touch-none overflow-hidden rounded-full border-2 border-accent bg-surface ${dimensions && !isApplying ? 'cursor-move' : 'cursor-wait'}`}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <img
                  src={imageUrl}
                  alt="Profile crop preview"
                  onLoad={handleImageLoad}
                  draggable="false"
                  className="pointer-events-none absolute max-w-none select-none"
                  style={imageStyle}
                />
                {!dimensions ? <span className="absolute inset-0 grid place-items-center text-xs text-muted">Loading preview…</span> : null}
              </div>
              <span className="text-xs text-muted">Drag the image to reposition</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-medium text-muted">Saved picture preview</span>
              <div className="relative h-20 w-20 overflow-hidden rounded-full border border-border bg-surface">
                <img src={imageUrl} alt="Cropped avatar preview" className="absolute max-w-none" style={imageStyle} />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border bg-bg px-6 text-center text-sm text-muted">
            Upload a PNG, JPEG, or WebP image to start cropping.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-xs font-medium text-muted">
            <span className="flex justify-between">Zoom <span>{Math.round(zoom * 100)}%</span></span>
            <input aria-label="Picture zoom" type="range" min="1" max="3" step="0.05" value={zoom} disabled={!dimensions || isApplying} onChange={(event) => setZoom(Number(event.target.value))} className="mt-2 block w-full accent-accent" />
          </label>
          <label className="block text-xs font-medium text-muted">
            <span className="flex justify-between">Horizontal position <span>{Math.round(positionX)}%</span></span>
            <input aria-label="Picture horizontal position" type="range" min="0" max="100" value={positionX} disabled={!dimensions || !canMoveX || isApplying} onChange={(event) => setPositionX(Number(event.target.value))} className="mt-2 block w-full accent-accent" />
          </label>
          <label className="block text-xs font-medium text-muted">
            <span className="flex justify-between">Vertical position <span>{Math.round(positionY)}%</span></span>
            <input aria-label="Picture vertical position" type="range" min="0" max="100" value={positionY} disabled={!dimensions || !canMoveY || isApplying} onChange={(event) => setPositionY(Number(event.target.value))} className="mt-2 block w-full accent-accent" />
          </label>
        </div>

        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" disabled={isApplying} onClick={close}>Cancel</Button>
          <Button type="button" disabled={!file || !dimensions || isApplying} onClick={applyCrop}>{isApplying ? 'Preparing…' : 'Use cropped picture'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default ProfilePictureCropModal
