import Badge from '../ui/Badge'

function ScheduleList({ schedule, loading, error, onRetry }) {
  if (loading) {
    return <p role="status" className="py-5 text-center text-sm text-muted">Loading schedule…</p>
  }

  if (error) {
    return (
      <div role="alert" className="py-4">
        <p className="text-sm text-danger">{error}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold text-accent hover:underline">
          Try again
        </button>
      </div>
    )
  }

  if (!schedule.length) {
    return <p className="py-5 text-center text-sm text-muted">No bookings scheduled for this date.</p>
  }

  return (
    <ul className="divide-y divide-border">
      {schedule.map((booking) => (
        <li key={booking.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-1 last:pb-1">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">{booking.user || 'Customer'}</p>
            <p className="mt-1 text-xs text-muted">
              {booking.facility}
              {booking.courtNames?.length ? ` · ${booking.courtNames.join(', ')}` : ''}
              {booking.quantity > 1 ? ` (${booking.quantity} courts)` : ''}
            </p>
            {booking.courtSchedules?.length ? (
              <div className="mt-1 space-y-1 text-xs text-muted">
                {booking.courtSchedules.map((court, index) => (
                  <p key={court.courtId ?? index}>Court {court.courtNumber ?? index + 1}: {court.startTime} - {court.endTime}</p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">
                Time: {booking.startTime && booking.endTime ? `${booking.startTime} - ${booking.endTime}` : booking.time || 'Unavailable'}
              </p>
            )}
          </div>
          <Badge tone={booking.status === 'Confirmed' ? 'success' : booking.status === 'Pending' ? 'pending' : 'neutral'}>
            {booking.status}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export default ScheduleList
