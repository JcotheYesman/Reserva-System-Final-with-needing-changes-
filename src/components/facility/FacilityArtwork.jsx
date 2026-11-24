function FacilityArtwork({ facility, className = 'h-32', showStatus = false, showEquipmentRental = false }) {
  const color = facility.color || '#475569'
  const initials = String(facility.sport ?? '').slice(0, 2).toUpperCase()
  const hasEquipmentRental = facility.equipmentRental === true ||
    facility.amenities?.some((amenity) => String(amenity).trim().toLowerCase() === 'equipment rental')

  return (
    <div className={`relative isolate flex items-center justify-between gap-2 overflow-hidden p-3 ${className}`} style={{ backgroundColor: color }}>
      {facility.image ? <img src={facility.image} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" /> : null}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/35 to-black/10" />
      {!facility.image ? <span aria-hidden="true" className="absolute right-3 top-1/2 -z-10 -translate-y-1/2 text-5xl font-black tracking-widest text-white/15">{initials}</span> : null}
      <div className="min-w-0 text-white">
        <h3 className="truncate text-sm font-bold">{facility.name}</h3>
        <p className="mt-1 truncate text-xs text-white/85">{facility.sport}</p>
      </div>
      {showStatus ? (
        <span className="shrink-0 self-start rounded bg-bg/75 px-2 py-1 text-[10px] font-bold text-white">
          {facility.active ? 'ACTIVE' : 'PAUSED'}
        </span>
      ) : null}
      {showEquipmentRental && hasEquipmentRental ? (
        <span className="absolute bottom-2 right-2 rounded border border-accent/60 bg-bg/90 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-accent shadow-sm">
          Equipment rental
        </span>
      ) : null}
    </div>
  )
}

export default FacilityArtwork
