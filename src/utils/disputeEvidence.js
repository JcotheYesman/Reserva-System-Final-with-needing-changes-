const MAX_COMPRESSED_BYTES = 450_000
const MAX_IMAGE_DIMENSION = 1600

export async function prepareDisputeEvidence(file) {
  if (!file?.type?.startsWith('image/')) throw new Error(`${file?.name || 'This file'} is not an image.`)
  if (file.size > 30_000_000) throw new Error(`${file.name} is larger than 30 MB.`)

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`Could not prepare ${file.name}.`)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    let quality = 0.86
    let blob = await canvasToBlob(canvas, quality)
    while (blob.size > MAX_COMPRESSED_BYTES && quality > 0.48) {
      quality = Math.max(0.48, quality - 0.08)
      blob = await canvasToBlob(canvas, quality)
    }
    if (blob.size > MAX_COMPRESSED_BYTES) throw new Error(`${file.name} could not be compressed below 450 KB.`)
    const data = await blobToDataUrl(blob)
    return {
      id: crypto.randomUUID(),
      name: file.name,
      description: '',
      data,
      uploaded: false,
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(`Could not read ${file.name}.`)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), 'image/jpeg', quality)
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Image could not be read.'))
    reader.readAsDataURL(blob)
  })
}
