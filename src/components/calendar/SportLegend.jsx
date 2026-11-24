import { useState } from 'react'
import Button from '../ui/Button'
import { facilityService } from '../../services/facilityService'

function SportLegend({ sports = [], onColorSaved }) {
  const [colors, setColors] = useState({})
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleEditing() {
    if (isEditing) {
      setIsEditing(false)
      setColors({})
      setError('')
      return
    }
    setColors(Object.fromEntries(sports.map((sport) => [sport.id, sport.color ?? '#64748b'])))
    setError('')
    setIsEditing(true)
  }

  async function saveChanges() {
    setIsSaving(true)
    setError('')
    try {
      for (const sport of sports) {
        const color = colors[sport.id] ?? sport.color ?? '#64748b'
        if (color.toLowerCase() !== String(sport.color ?? '').toLowerCase()) {
          await facilityService.updateSportColor(sport.id, color)
        }
      }
      setIsEditing(false)
      setColors({})
      onColorSaved?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Sport colors could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Legend</h2>
        <Button type="button" variant="secondary" disabled={isSaving} onClick={toggleEditing} className="shrink-0 px-2.5 py-1.5 text-xs">
          {isEditing ? 'Cancel' : 'Edit Color'}
        </Button>
      </header>
      <ul className="space-y-2.5">
        {sports.map((sport) => (
          <li key={sport.id} className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[sport.id] ?? sport.color }} />
            <span className="min-w-0 flex-1 truncate">{sport.name}</span>
            {isEditing ? (
              <input
                type="color"
                aria-label={`${sport.name} legend color`}
                value={colors[sport.id] ?? sport.color ?? '#64748b'}
                onChange={(event) => setColors((current) => ({ ...current, [sport.id]: event.target.value }))}
                disabled={isSaving}
                className="h-7 w-10 shrink-0 cursor-pointer rounded border border-border bg-surface p-0.5"
              />
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {isEditing ? (
        <div className="flex justify-end border-t border-border pt-3">
          <Button type="button" disabled={isSaving} onClick={saveChanges} className="px-3 py-1.5 text-xs">
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default SportLegend
