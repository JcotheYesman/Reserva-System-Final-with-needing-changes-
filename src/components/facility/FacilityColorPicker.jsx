import { facilityColors } from '../../utils/facilityAppearance'

function FacilityColorPicker({ value, onChange, disabled = false }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-xs font-semibold text-text">Card color when no photo is shown</legend>
      <div className="flex flex-wrap gap-2">
        {facilityColors.map((color) => (
          <button
            key={color.value}
            type="button"
            aria-label={`${color.name} card color`}
            aria-pressed={value === color.value}
            title={color.name}
            onClick={() => onChange(color.value)}
            className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info ${value === color.value ? 'border-white ring-2 ring-info' : 'border-transparent'}`}
            style={{ backgroundColor: color.value }}
          />
        ))}
      </div>
    </fieldset>
  )
}

export default FacilityColorPicker
