import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import StatCard from '../components/ui/StatCard'
import { facilityService } from '../services/facilityService'
import { reservationService } from '../services/reservationService'
import { authService } from '../services/authService'

const facilityStyles = {
  Football: { color: 'bg-danger', icon: 'FB' },
  Basketball: { color: 'bg-accent', icon: 'BK' },
  Tennis: { color: 'bg-success', icon: 'TN' },
  Volleyball: { color: 'bg-info', icon: 'VB' },
  Badminton: { color: 'bg-brand', icon: 'BD' },
  Swimming: { color: 'bg-info', icon: 'SW' },
}

const statLabels = ['Active Reservations', 'Total Reservations', 'Pending Reservations']

function reservationTone(status) {
  if (status === 'Confirmed') return 'success'
  if (status === 'Pending') return 'pending'
  if (status === 'Cancelled') return 'danger'
  return 'neutral'
}

function DashboardPage() {
  const [dashboard, setDashboard] = useState(null)
  const [facilities, setFacilities] = useState([])
  const [accountName, setAccountName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let isCurrent = true

    async function loadDashboard() {
      setIsLoading(true)
      setError('')
      try {
        const [dashboardData, facilityData] = await Promise.all([
          reservationService.getDashboard(),
          facilityService.getFacilities(),
        ])
        if (isCurrent) {
          const facilitiesById = new Map(facilityData.map((facility) => [String(facility.id), facility]))
          setDashboard({
            ...dashboardData,
            reservations: dashboardData.reservations.map((reservation) => ({
              ...reservation,
              image: facilitiesById.get(String(reservation.facilityId))?.image ?? reservation.image ?? null,
            })),
          })
          setFacilities(facilityData.slice(0, 3))
        }
      } catch (loadError) {
        if (isCurrent) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Dashboard information could not be loaded.',
          )
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    authService.getSession()
      .then((user) => {
        if (isCurrent) setAccountName(user?.name?.trim().split(/\s+/)[0] || '')
      })
      .catch(() => {})

    loadDashboard()
    return () => {
      isCurrent = false
    }
  }, [attempt])

  if (isLoading) {
    return (
      <div role="status" className="rounded-card border border-border bg-surface p-6 text-sm text-muted">
        Loading your dashboard…
      </div>
    )
  }

  if (error) {
    return (
      <Card role="alert" className="border-danger/50">
        <h1 className="text-base font-bold">Dashboard unavailable</h1>
        <p className="mt-2 text-sm text-muted">{error}</p>
        <Button className="mt-4" onClick={() => setAttempt((current) => current + 1)}>
          Try again
        </Button>
      </Card>
    )
  }

  const reservations = dashboard?.reservations ?? []
  const statValues = dashboard?.stats ?? []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Your sports reservations</p>
          <h1 className="mt-1 text-xl font-bold text-text">Welcome back{accountName ? `, ${accountName}` : ''}!</h1>
        </div>
        <Link to="/sports-facilities" className="text-xs font-semibold text-success hover:underline">
          Browse facilities
        </Link>
      </header>

      <section aria-label="Reservation statistics" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {statLabels.map((label, index) => (
          <StatCard
            key={label}
            label={label}
            value={statValues[index] ?? 0}
            className="min-h-20"
          />
        ))}
      </section>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-text">Upcoming Reservations</h2>
          <Link
            to="/reserved-schedule"
            className="text-xs font-semibold text-success hover:underline"
          >
            View all
          </Link>
        </div>
        {reservations.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th aria-label="Facility image" className="w-14 py-2 pr-3" />
                  <th scope="col" className="py-2 pr-3">FACILITY</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2">DATE &amp; TIME</th>
                  <th scope="col" className="px-3 py-2 text-center">STATUS</th>
                  <th scope="col" className="py-2 pl-3 text-right">TOTAL PAID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td className="py-3 pr-3">
                      <div aria-hidden="true" className="h-12 w-14 overflow-hidden rounded border border-border bg-sidebar">
                        {reservation.image ? (
                          <img src={reservation.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-sm font-semibold text-text">{reservation.name}</td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {reservation.courtSchedules?.length ? (
                        <div className="space-y-1">
                          {reservation.courtSchedules.map((court, index) => (
                            <p key={court.courtId ?? index} className="whitespace-nowrap">
                              {reservation.date} <span aria-hidden="true">&middot;</span> Court {court.courtNumber ?? index + 1}: {court.startTime} - {court.endTime}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="whitespace-nowrap">{reservation.date} <span aria-hidden="true">&middot;</span> {reservation.time}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Badge tone={reservationTone(reservation.status)}>{reservation.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap py-3 pl-3 text-right text-sm font-bold text-accent">
                      &#8369;{reservation.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-5 text-center text-sm text-muted">
            You don&apos;t have any upcoming reservations.
          </p>
        )}
      </Card>

      <section aria-labelledby="featured-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="featured-title" className="text-sm font-bold text-text">
            Featured Facilities
          </h2>
          <Link
            to="/sports-facilities"
            className="text-xs font-semibold text-success hover:underline"
          >
            See all
          </Link>
        </div>
        {facilities.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facilities.map((facility) => {
              const visual = facilityStyles[facility.sport] ?? {
                color: 'bg-sidebar',
                icon: facility.sport.slice(0, 2).toUpperCase(),
              }
              return (
                <Link
                  key={facility.id}
                  to="/sports-facilities"
                  className="group overflow-hidden rounded-card border border-border bg-surface transition-colors hover:border-muted"
                >
                  <div
                    aria-hidden="true"
                    className={`relative flex h-20 items-center justify-center overflow-hidden ${visual.color}`}
                    style={{ backgroundColor: facility.color || undefined }}
                  >
                    {facility.image ? (
                      <img
                        src={facility.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl font-black text-white/90">{visual.icon}</span>
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-text group-hover:text-success">
                          {facility.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted">{facility.sport}</p>
                      </div>
                      <span className="whitespace-nowrap text-xs font-bold text-accent">
                        {facility.price}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-xs text-success">{facility.availability} available</span>
                      <span className="text-xs font-semibold text-info">View facility</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <Card>
            <p className="py-3 text-center text-sm text-muted">No featured facilities available.</p>
          </Card>
        )}
      </section>
    </div>
  )
}

export default DashboardPage
