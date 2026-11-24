export const acceptedProfilePictureTypes = ['image/png', 'image/jpeg', 'image/webp']

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('The selected picture could not be read.'))
    reader.readAsDataURL(blob)
  })
}

export async function resizeProfilePicture(file, crop = {}) {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const zoom = Math.min(3, Math.max(1, Number(crop.zoom) || 1))
    const positionX = Math.min(100, Math.max(0, Number(crop.positionX ?? 50))) / 100
    const positionY = Math.min(100, Math.max(0, Number(crop.positionY ?? 50))) / 100
    const sourceSize = Math.min(bitmap.width, bitmap.height) / zoom
    const sourceX = (bitmap.width - sourceSize) * positionX
    const sourceY = (bitmap.height - sourceSize) * positionY
    const drawSquare = (size) => {
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not prepare the selected picture.')
      context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)
    }
    drawSquare(384)
    let blob = await canvasBlob(canvas, 'image/webp', 0.8)
    if (!blob || !acceptedProfilePictureTypes.includes(blob.type)) blob = await canvasBlob(canvas, 'image/jpeg', 0.8)
    if (!blob || !acceptedProfilePictureTypes.includes(blob.type)) throw new Error('This browser could not prepare the selected picture.')
    if (blob.size > 250_000) {
      drawSquare(256)
      blob = await canvasBlob(canvas, 'image/webp', 0.7)
      if (!blob || !acceptedProfilePictureTypes.includes(blob.type)) blob = await canvasBlob(canvas, 'image/jpeg', 0.7)
    }
    if (!blob || blob.size > 250_000) throw new Error('Choose a smaller image file and try again.')
    return await blobDataUrl(blob)
  } finally {
    bitmap.close()
  }
}
