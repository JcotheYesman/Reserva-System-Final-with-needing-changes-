import { useEffect, useState } from 'react'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Modal from '../ui/Modal'
import Select from '../ui/Select'
import { promoService } from '../../services/promoService'
import { formatPHP } from '../../utils/fees'

const defaultForm = { discountType: 'percent', value: '15', minimumBooking: '100', usageLimit: '50' }

function describeDiscount(promo) {
  if (promo.discountType === 'percent') return `${promo.value}% off rental`
  if (promo.discountType === 'fixed') return `${formatPHP(promo.value)} off rental`
  return 'Platform service fee waived'
}

function AdminPromoCodesModal({ open, onClose }) {
  const [promos, setPromos] = useState([])
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let active = true
    setLoading(true)
    setError('')
    promoService.listAdminPromos()
      .then((rows) => { if (active) setPromos(rows) })
      .catch((loadError) => { if (active) setError(loadError.message || 'Promo codes could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  async function generate(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const promo = await promoService.generateAdminPromo({
        ...form,
        value: form.discountType === 'fee-waived' ? 0 : Number(form.value),
        minimumBooking: Number(form.minimumBooking),
        usageLimit: Number(form.usageLimit),
      })
      setPromos((current) => [promo, ...current])
      setNotice(`Promo code ${promo.code} generated and saved.`)
      setForm(defaultForm)
    } catch (generateError) {
      setError(generateError.message || 'Promo code could not be generated.')
    } finally {
      setSaving(false)
    }
  }

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
    setNotice('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Admin · Promo codes" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <div className="space-y-5">
        <form className="space-y-3 rounded-md border border-border p-3" onSubmit={generate}>
          <div>
            <h3 className="text-sm font-bold">Generate a promo code</h3>
            <p className="mt-1 text-xs text-muted">Generated codes are stored in the database and can be entered by users in booking checkout.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Discount type"
              value={form.discountType}
              onChange={(event) => update('discountType', event.target.value)}
              options={[
                { value: 'percent', label: 'Percent off rental' },
                { value: 'fixed', label: 'Fixed amount off rental' },
                { value: 'fee-waived', label: 'Waive service fee' },
              ]}
            />
            <Input
              label={form.discountType === 'percent' ? 'Discount (%)' : 'Discount value (₱)'}
              type="number"
              value={form.discountType === 'fee-waived' ? '0' : form.value}
              onChange={(event) => update('value', event.target.value)}
              min={form.discountType === 'percent' ? 0.01 : 0.01}
              max={form.discountType === 'percent' ? 100 : undefined}
              step="0.01"
              required={form.discountType !== 'fee-waived'}
              disabled={form.discountType === 'fee-waived'}
            />
            <Input label="Minimum booking (₱)" type="number" value={form.minimumBooking} onChange={(event) => update('minimumBooking', event.target.value)} min="0" step="0.01" required />
            <Input label="Usage limit" type="number" value={form.usageLimit} onChange={(event) => update('usageLimit', event.target.value)} min="1" step="1" required />
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
          <Button type="submit" disabled={saving} className="w-full">{saving ? 'Generating…' : 'Generate code'}</Button>
        </form>

        <section className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 border-b border-border px-1 pb-2 text-xs font-medium text-muted">
            <span>Code</span><span>Discount</span><span>Minimum</span><span>Used</span>
          </div>
          {loading ? <p role="status" className="py-3 text-sm text-muted">Loading promo codes…</p> : null}
          {!loading && !promos.length ? <p className="py-3 text-sm text-muted">No promo codes generated yet.</p> : null}
          {promos.map((promo) => (
            <div key={promo.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-1 py-2 text-xs">
              <span className="break-all font-bold text-accent">{promo.code}</span>
              <span>{describeDiscount(promo)}</span>
              <span>{formatPHP(promo.minimumBooking)}</span>
              <span className="whitespace-nowrap"><Badge tone={promo.active ? 'success' : 'neutral'}>{promo.usedCount}/{promo.usageLimit}</Badge></span>
            </div>
          ))}
        </section>
        <div className="flex justify-end border-t border-border pt-3"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  )
}

export default AdminPromoCodesModal
