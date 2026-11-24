import { useEffect, useMemo, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { bookedEquipmentHours, calculateEquipmentTotal } from '../../utils/equipmentRental'
import { formatPHP } from '../../utils/fees'

export default function EquipmentRentalModal({ open, facility, courtBookings = [], initialItems = [], onClose, onApply }) {
  const categories = facility?.equipmentCategories ?? []
  const [activeCategory, setActiveCategory] = useState('All')
  const [selectedItems, setSelectedItems] = useState([])
  const hours = bookedEquipmentHours(courtBookings)
  useEffect(() => {
    if (!open) return
    setActiveCategory('All')
    setSelectedItems(initialItems.map((item) => ({ itemId: Number(item.itemId), quantity: Number(item.quantity) })))
  }, [open, initialItems])
  const visibleItems = useMemo(() => categories.flatMap((category) =>
    (activeCategory === 'All' || activeCategory === category.name
      ? (category.items ?? []).map((item) => ({ ...item, categoryName: category.name }))
      : [])), [categories, activeCategory])
  const rentalTotal = calculateEquipmentTotal(categories, selectedItems, courtBookings)
  const selectedLines = categories.flatMap((category) => (category.items ?? []).flatMap((item) => {
    const quantity = selectedItems.find((selected) => Number(selected.itemId) === Number(item.id))?.quantity ?? 0
    return quantity > 0 ? [{ ...item, categoryName: category.name, quantity }] : []
  }))

  function setQuantity(item, delta) {
    setSelectedItems((current) => {
      const existing = current.find((entry) => Number(entry.itemId) === Number(item.id))
      const nextQuantity = (existing?.quantity ?? 0) + delta
      if (nextQuantity < 1) return current.filter((entry) => Number(entry.itemId) !== Number(item.id))
      if (nextQuantity > Number(item.stockQuantity)) return current
      return existing
        ? current.map((entry) => Number(entry.itemId) === Number(item.id) ? { ...entry, quantity: nextQuantity } : entry)
        : [...current, { itemId: Number(item.id), quantity: nextQuantity }]
    })
  }

  function applySelection() {
    onApply(selectedItems.map((item) => ({ itemId: Number(item.itemId), quantity: Number(item.quantity) })))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Rent equipment" className="max-h-[92vh] max-w-5xl overflow-hidden">
      <div className="-m-4 flex max-h-[calc(92vh-4rem)] min-h-[480px] flex-col">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs text-muted">{facility?.name} · {facility?.sport} · Pick what you need for your game</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {[{ name: 'All', count: categories.reduce((total, category) => total + (category.items?.length ?? 0), 0) }, ...categories.map((category) => ({ name: category.name, count: category.items?.length ?? 0 }))].map((category) => (
              <button key={category.name} type="button" onClick={() => setActiveCategory(category.name)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${activeCategory === category.name ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-muted'}`}>
                {category.name} <span className="ml-1 opacity-75">{category.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_290px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {!categories.length || !visibleItems.length ? <p className="rounded-md border border-border p-5 text-sm text-muted">No equipment is listed in this category.</p> : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleItems.map((item) => {
                  const quantity = selectedItems.find((selected) => Number(selected.itemId) === Number(item.id))?.quantity ?? 0
                  const unavailable = Number(item.stockQuantity) <= 0
                  return <article key={item.id} className={`rounded-xl border p-3 ${quantity ? 'border-accent' : 'border-border'} ${unavailable ? 'opacity-50' : ''}`}>
                    {item.image ? <img src={item.image} alt={item.name} className="h-40 w-full rounded-lg bg-bg object-cover sm:h-44" /> : <div className="grid h-40 place-items-center rounded-lg bg-bg sm:h-44"><span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-lg font-bold text-white">{item.name.slice(0, 1).toUpperCase()}</span></div>}
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">{item.categoryName}</p>
                    <h3 className="mt-1 text-sm font-bold">{item.name}</h3>
                    <p className="mt-1 text-xs"><strong className="text-accent">{formatPHP(item.unitPrice)}</strong><span className="text-muted"> / {item.billingUnit === 'hour' ? 'hour' : 'item'}</span></p>
                    <p className="mt-1 text-[11px] text-muted">{Number(item.stockQuantity)} in stock{item.billingUnit === 'hour' ? hours ? ` · × ${hours} hr` : ' · choose time slots to price' : ''}</p>
                    {item.billingUnit === 'hour' && hours > 0 ? <p className="mt-1 text-xs text-muted">Selected: {formatPHP(Number(item.unitPrice) * quantity * hours)}</p> : null}
                    <div className="mt-3 flex items-center justify-between rounded-md border border-accent/50 bg-accent/5 px-2 py-1.5">
                      <button type="button" disabled={quantity === 0} onClick={() => setQuantity(item, -1)} className="px-2 font-bold text-accent disabled:opacity-30" aria-label={`Remove one ${item.name}`}>−</button>
                      <span className="text-xs font-bold">{quantity} rented</span>
                      <button type="button" disabled={unavailable || quantity >= Number(item.stockQuantity)} onClick={() => setQuantity(item, 1)} className="px-2 font-bold text-accent disabled:opacity-30" aria-label={`Rent one ${item.name}`}>+</button>
                    </div>
                  </article>
                })}
              </div>
            )}
          </div>
          <aside className="flex min-h-0 flex-col border-t border-border md:border-l md:border-t-0">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <h3 className="text-sm font-bold">Your rentals</h3>
              {selectedLines.length ? <div className="mt-3 space-y-4">
                {categories.map((category) => {
                  const lines = selectedLines.filter((line) => line.categoryName === category.name)
                  return lines.length ? <div key={category.name}><p className="mb-2 text-[10px] font-bold text-accent">{category.name}</p><div className="space-y-2">{lines.map((line) => <div key={line.id} className="flex items-center gap-2 text-xs">
                    {line.image ? <img src={line.image} alt="" className="h-12 w-12 rounded-md object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded bg-bg text-xs font-bold text-accent">{line.name.slice(0, 1).toUpperCase()}</span>}
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{line.name} × {line.quantity}</p><p className="text-[10px] text-muted">{formatPHP(line.unitPrice)} / {line.billingUnit === 'hour' ? `hour × ${hours} hr` : 'item'}</p></div>
                    {line.billingUnit === 'hour' ? <strong>{formatPHP(Number(line.unitPrice) * line.quantity * hours)}</strong> : <strong>{formatPHP(Number(line.unitPrice) * line.quantity)}</strong>}
                    <button type="button" onClick={() => setSelectedItems((current) => current.filter((selected) => Number(selected.itemId) !== Number(line.id)))} className="px-1 text-muted" aria-label={`Remove ${line.name}`}>×</button>
                  </div>)}</div></div> : null
                })}
              </div> : <p className="mt-3 text-xs text-muted">No equipment selected yet.</p>}
            </div>
            <div className="border-t border-border p-4">
              <div className="flex justify-between text-xs"><span className="text-muted">Time booked</span><strong>{hours ? `${hours} hr${hours === 1 ? '' : 's'}` : 'Not chosen yet'}</strong></div>
              {!hours && selectedLines.some((item) => item.billingUnit === 'hour') ? <p className="mt-2 text-[10px] text-accent">Choose your time slots to price per-hour items.</p> : null}
              <div className="mt-3 flex justify-between text-sm font-bold"><span>Rentals total</span><span className="text-accent">{formatPHP(rentalTotal)}</span></div>
              <Button className="mt-3 w-full" disabled={selectedLines.some((item) => item.billingUnit === 'hour') && !hours} onClick={applySelection}>Add to booking · {formatPHP(rentalTotal)}</Button>
              <button type="button" className="mt-2 w-full text-xs text-muted underline" onClick={() => setSelectedItems([])}>Clear all</button>
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  )
}
