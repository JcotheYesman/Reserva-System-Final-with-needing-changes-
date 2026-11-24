import { useMemo, useState } from 'react'
import Button from '../ui/Button'

export default function AmenityEquipmentEditor({
  amenities = [],
  amenityOptions = [],
  equipmentCategories = [],
  onAmenitiesChange,
  onEquipmentCategoriesChange,
  disabled = false,
}) {
  const equipmentRentalEnabled = amenities.some((item) => item.toLowerCase() === 'equipment rental')

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Amenities (optional)</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {amenityOptions.map((amenity) => (
            <label key={amenity} className="flex items-center gap-2 rounded border border-border bg-bg px-3 py-2 text-xs text-text">
              <input
                type="checkbox"
                checked={amenities.includes(amenity)}
                disabled={disabled}
                onChange={(event) => onAmenitiesChange(event.target.checked
                  ? [...amenities, amenity]
                  : amenities.filter((item) => item !== amenity))}
                className="accent-success"
              />
              {amenity}
            </label>
          ))}
        </div>
      </fieldset>
      {equipmentRentalEnabled ? (
        <EquipmentCatalogEditor categories={equipmentCategories} onChange={onEquipmentCategoriesChange} disabled={disabled} />
      ) : null}
    </div>
  )
}

function EquipmentCatalogEditor({ categories, onChange, disabled }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editCategoryName, setEditCategoryName] = useState(null)
  const [categoryError, setCategoryError] = useState('')
  const [itemDraft, setItemDraft] = useState({ name: '', unitPrice: '', billingUnit: 'hour', stockQuantity: '1', image: null })
  const [itemError, setItemError] = useState('')
  const activeCategory = categories[activeIndex]
  const selectedNames = useMemo(() => new Set(categories.map((category) => category.name.trim().toLowerCase())), [categories])

  function addCategory() {
    const name = newCategoryName.trim()
    if (!name || selectedNames.has(name.toLowerCase())) {
      setCategoryError(name ? 'A category with that name already exists.' : 'Enter a category name.')
      return
    }
    onChange([...categories, { name, items: [] }])
    setActiveIndex(categories.length)
    setNewCategoryName('')
    setCategoryError('')
  }

  function saveCategoryName() {
    const name = String(editCategoryName ?? '').trim()
    if (!name || categories.some((category, index) => index !== activeIndex && category.name.trim().toLowerCase() === name.toLowerCase())) {
      setCategoryError(name ? 'A category with that name already exists.' : 'Enter a category name.')
      return
    }
    onChange(categories.map((category, index) => index === activeIndex ? { ...category, name } : category))
    setEditCategoryName(null)
    setCategoryError('')
  }

  function updateItem(index, changes) {
    onChange(categories.map((category, categoryIndex) => categoryIndex !== activeIndex ? category : {
      ...category,
      items: category.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item),
    }))
  }

  async function readImage(file) {
    if (!file) return null
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('The image could not be read.'))
      reader.readAsDataURL(file)
    })
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image()
      loaded.onload = () => resolve(loaded)
      loaded.onerror = () => reject(new Error('Choose a valid image file.'))
      loaded.src = source
    })
    const scale = Math.min(1, 640 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/jpeg', 0.78)
    if (result.length > 550_000) throw new Error('The equipment photo is too large. Choose a smaller image.')
    return result
  }

  function addItem() {
    const name = itemDraft.name.trim()
    const price = Number(itemDraft.unitPrice)
    const stock = Number(itemDraft.stockQuantity)
    if (!activeCategory || !name || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
      setItemError('Enter an item name, non-negative price, and available quantity.')
      return
    }
    onChange(categories.map((category, index) => index === activeIndex ? {
      ...category,
      items: [...category.items, {
        clientKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        unitPrice: price,
        billingUnit: itemDraft.billingUnit,
        stockQuantity: stock,
        image: itemDraft.image,
      }],
    } : category))
    setItemDraft({ name: '', unitPrice: '', billingUnit: 'hour', stockQuantity: '1', image: null })
    setItemError('')
  }

  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-bold">Equipment title</h3><p className="mt-1 text-[11px] text-muted">Create categories and add equipment photos, rental prices, and stock.</p></div>
        <span className="text-[10px] text-muted">Prices can be hourly or per item</span>
      </div>
      <div className="mt-3 flex gap-2">
        <input value={newCategoryName} onChange={(event) => { setNewCategoryName(event.target.value); setCategoryError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCategory() } }} disabled={disabled} maxLength={100} placeholder="New category name" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-xs text-text" />
        <Button type="button" disabled={disabled || !newCategoryName.trim()} onClick={addCategory} className="px-3 text-xs">Add category</Button>
      </div>
      {categoryError ? <p role="alert" className="mt-2 text-xs text-danger">{categoryError}</p> : null}
      {categories.length ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((category, index) => <button key={`${category.name}-${index}`} type="button" onClick={() => { setActiveIndex(index); setEditCategoryName(null); setItemError('') }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${index === activeIndex ? 'border-accent bg-accent text-bg' : 'border-border bg-bg text-muted'}`}>{category.name || `Category ${index + 1}`}</button>)}
          </div>
          {activeCategory ? <div className="mt-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editCategoryName === null ? <h4 className="text-xs font-bold">{activeCategory.name}</h4> : <div className="flex min-w-0 flex-1 gap-2"><input autoFocus value={editCategoryName} onChange={(event) => { setEditCategoryName(event.target.value); setCategoryError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCategoryName() } }} maxLength={100} className="h-8 min-w-0 flex-1 rounded border border-border bg-bg px-2 text-xs text-text" /><Button type="button" disabled={disabled} onClick={saveCategoryName} className="px-2 py-1 text-[10px]">Save</Button><Button type="button" variant="secondary" className="px-2 py-1 text-[10px]" onClick={() => { setEditCategoryName(null); setCategoryError('') }}>Cancel</Button></div>}
              {editCategoryName === null ? <div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => setEditCategoryName(activeCategory.name)} className="text-[10px] font-semibold text-accent underline disabled:opacity-50">Edit category name</button><button type="button" disabled={disabled} onClick={() => { onChange(categories.filter((_, index) => index !== activeIndex)); setActiveIndex(Math.max(0, activeIndex - 1)) }} className="text-[10px] font-semibold text-danger underline disabled:opacity-50">Remove category</button></div> : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2" onKeyDown={(event) => { if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); event.stopPropagation(); addItem() } }}>
              <label className="text-[10px] text-muted">Equipment item<input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} disabled={disabled} maxLength={120} placeholder="e.g. Racket" className="mt-1 h-9 w-full rounded border border-border bg-bg px-2 text-xs text-text" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-muted">Price (₱)<input type="number" min="0" step="0.01" value={itemDraft.unitPrice} onChange={(event) => setItemDraft({ ...itemDraft, unitPrice: event.target.value })} disabled={disabled} className="mt-1 h-9 w-full rounded border border-border bg-bg px-2 text-xs text-text" /></label><label className="text-[10px] text-muted">Billing<select value={itemDraft.billingUnit} onChange={(event) => setItemDraft({ ...itemDraft, billingUnit: event.target.value })} disabled={disabled} className="mt-1 h-9 w-full rounded border border-border bg-bg px-2 text-xs text-text"><option value="hour">Per hour</option><option value="piece">Per item</option></select></label></div>
              <label className="text-[10px] text-muted">Stock available<input type="number" min="0" step="1" value={itemDraft.stockQuantity} onChange={(event) => setItemDraft({ ...itemDraft, stockQuantity: event.target.value })} disabled={disabled} className="mt-1 h-9 w-full rounded border border-border bg-bg px-2 text-xs text-text" /></label>
              <label className="text-[10px] text-muted">Picture of equipment<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => { try { const image = await readImage(event.target.files?.[0]); setItemDraft((current) => ({ ...current, image })); setItemError('') } catch (error) { setItemError(error.message) } }} className="mt-1 block w-full text-[10px] text-text file:mr-2 file:rounded file:border-0 file:bg-bg file:px-2 file:py-1" />{itemDraft.image ? <img src={itemDraft.image} alt="Equipment preview" className="mt-2 h-32 w-48 max-w-full rounded-lg object-cover" /> : null}</label>
              <div className="sm:col-span-2"><Button type="button" variant="secondary" disabled={disabled || !activeCategory} onClick={addItem} className="px-3 py-1.5 text-xs">Add item</Button></div>
            </div>
            {itemError ? <p role="alert" className="mt-2 text-xs text-danger">{itemError}</p> : null}
            <div className="mt-3 space-y-2">
              {activeCategory.items.map((item, index) => <div key={item.id ?? item.clientKey ?? index} className="grid gap-2 rounded border border-border bg-bg p-3 sm:grid-cols-2">
                {item.image ? <img src={item.image} alt={item.name} className="h-36 w-full max-w-sm rounded-lg object-cover sm:col-span-2" /> : <div className="grid h-36 w-full max-w-sm place-items-center rounded-lg bg-surface text-2xl font-bold text-accent sm:col-span-2">{item.name.slice(0, 1).toUpperCase()}</div>}
                <label className="flex flex-wrap items-center gap-2 text-[10px] text-muted sm:col-span-2">Picture of equipment<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => { try { updateItem(index, { image: await readImage(event.target.files?.[0]) }); setItemError('') } catch (error) { setItemError(error.message) } }} className="max-w-full text-[10px] text-text file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1" />{item.image ? <button type="button" disabled={disabled} onClick={() => updateItem(index, { image: null })} className="font-semibold text-danger">Remove photo</button> : null}</label>
                <input aria-label="Equipment name" value={item.name} disabled={disabled} onChange={(event) => updateItem(index, { name: event.target.value })} className="h-9 min-w-0 rounded border border-border bg-surface px-2 text-xs text-text" />
                <input aria-label="Equipment price" type="number" min="0" step="0.01" value={item.unitPrice} disabled={disabled} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} className="h-9 w-full rounded border border-border bg-surface px-2 text-xs text-text" />
                <select aria-label="Billing unit" value={item.billingUnit} disabled={disabled} onChange={(event) => updateItem(index, { billingUnit: event.target.value })} className="h-9 rounded border border-border bg-surface px-2 text-xs text-text"><option value="hour">Per hour</option><option value="piece">Per item</option></select>
                <input aria-label="Stock quantity" type="number" min="0" step="1" value={item.stockQuantity} disabled={disabled} onChange={(event) => updateItem(index, { stockQuantity: event.target.value })} className="h-9 w-full rounded border border-border bg-surface px-2 text-xs text-text" />
                <button type="button" disabled={disabled} onClick={() => onChange(categories.map((category, categoryIndex) => categoryIndex === activeIndex ? { ...category, items: category.items.filter((_, itemIndex) => itemIndex !== index) } : category))} className="justify-self-start text-xs font-semibold text-danger disabled:opacity-50">Remove item</button>
              </div>)}
              {!activeCategory.items.length ? <p className="text-xs text-muted">No items in this category yet.</p> : null}
            </div>
          </div> : null}
        </>
      ) : <p className="mt-3 rounded border border-dashed border-border p-3 text-xs text-muted">Add a category to start listing rentable equipment.</p>}
    </section>
  )
}
