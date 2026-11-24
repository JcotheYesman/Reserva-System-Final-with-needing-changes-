export const facilityColors = [
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Violet', value: '#6d28d9' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Green', value: '#15803d' },
  { name: 'Rose', value: '#be123c' },
  { name: 'Slate', value: '#475569' },
  { name: 'Amber', value: '#b45309' },
  { name: 'Indigo', value: '#4338ca' },
]

export function randomFacilityColor() {
  return facilityColors[Math.floor(Math.random() * facilityColors.length)].value
}

export function facilityColorForId(id) {
  const numericId = Number(id)
  const index = Number.isFinite(numericId) ? Math.abs(Math.trunc(numericId)) % facilityColors.length : 0
  return facilityColors[index].value
}
