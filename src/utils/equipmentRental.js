import { timeToMinutes } from './bookingTime'

export function bookedEquipmentHours(courtBookings = []) {
  const intervals = courtBookings
    .filter((booking) => booking?.startTime && booking?.endTime)
    .map((booking) => [timeToMinutes(booking.startTime), timeToMinutes(booking.endTime)])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0])
  if (!intervals.length) return 0
  let total = 0
  let [start, end] = intervals[0]
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd)
    else {
      total += end - start
      ;[start, end] = [nextStart, nextEnd]
    }
  }
  return (total + end - start) / 60
}

export function calculateEquipmentTotal(catalog = [], selectedItems = [], courtBookings = []) {
  const hours = bookedEquipmentHours(courtBookings)
  const items = new Map(catalog.flatMap((category) => (category.items ?? []).map((item) => [Number(item.id), item])))
  return selectedItems.reduce((total, selected) => {
    const item = items.get(Number(selected.itemId))
    const quantity = Math.max(0, Math.floor(Number(selected.quantity) || 0))
    if (!item || !quantity) return total
    const multiplier = item.billingUnit === 'hour' ? hours : 1
    return total + Number(item.unitPrice) * quantity * multiplier
  }, 0)
}

export function selectedEquipmentLines(catalog = [], selectedItems = [], courtBookings = []) {
  const hours = bookedEquipmentHours(courtBookings)
  const selected = new Map(selectedItems.map((entry) => [Number(entry.itemId), Number(entry.quantity)]))
  return catalog.flatMap((category) => (category.items ?? []).flatMap((item) => {
    const quantity = selected.get(Number(item.id)) ?? 0
    if (!quantity) return []
    const billedHours = item.billingUnit === 'hour' ? hours : 0
    const unitPrice = Number(item.unitPrice)
    return [{
      itemId: Number(item.id),
      categoryName: category.name,
      itemName: item.name,
      quantity,
      billingUnit: item.billingUnit,
      unitPrice,
      billedHours,
      lineTotal: unitPrice * quantity * (item.billingUnit === 'hour' ? billedHours : 1),
    }]
  }))
}
