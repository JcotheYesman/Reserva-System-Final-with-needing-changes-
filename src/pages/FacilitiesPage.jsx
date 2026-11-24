import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AsyncState from '../components/ui/AsyncState'
import FacilityArtwork from '../components/facility/FacilityArtwork'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import useAsyncResource from '../hooks/useAsyncResource'
import { facilityService } from '../services/facilityService'

function FacilitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? 'All'
  const [searchValue, setSearchValue] = useState(query)
  const loader = useCallback(
    () => facilityService.searchFacilities({ query, category }),
    [query, category],
  )
  const sportsLoader = useCallback(() => facilityService.getSports(), [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const { data: sports } = useAsyncResource(sportsLoader)
  const facilities = data ?? []
  const categories = ['All', ...(sports ?? []).map((sport) => sport.name)]

  useEffect(() => {
    if (sports && category !== 'All' && !sports.some((sport) => sport.name === category)) {
      setSearchParams({ q: query, category: 'All' })
    }
  }, [category, query, setSearchParams, sports])

  function updateFilters(nextQuery, nextCategory) {
    setSearchParams({ q: nextQuery, category: nextCategory })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeading
        title="Sports Facilities"
        description="Explore courts, compare rates, and check availability. You can browse without an account."
      />
      <div className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:grid-cols-[1fr_220px]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Search facilities</span>
          <input
            value={searchValue}
            onChange={(event) => {
              const next = event.target.value
              setSearchValue(next)
              updateFilters(next, category)
            }}
            placeholder="Facility name or sport"
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-muted"
          />
        </label>
        <Select
          label="Sport category"
          value={category}
          onChange={(event) => updateFilters(query, event.target.value)}
          options={categories}
          className="h-10"
        />
      </div>
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && facilities.length === 0} emptyMessage="No facilities match your search." />
      {!isLoading && !error && facilities.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {facilities.map((facility) => (
            <article key={facility.id} className="overflow-hidden rounded-card border border-border bg-surface">
              <FacilityArtwork facility={facility} />
              <div className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-text">{facility.name}</h2>
                    <p className="mt-1 text-xs text-muted">{facility.sport}{facility.active ? '' : ' · Under maintenance'}</p>
                    {facility.equipmentRental ? <span className="mt-2 inline-flex rounded-full border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">Equipment rental available</span> : null}
                  </div>
                  <span className="whitespace-nowrap text-sm font-bold text-accent">{facility.price}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className={`text-xs ${facility.active && facility.courtCount > 0 ? 'text-success' : 'text-muted'}`}>
                    {!facility.active ? 'View only · booking unavailable' : facility.courtCount > 0 ? `${facility.availability} available` : 'No courts configured'}
                  </span>
                  {facility.active && facility.courtCount > 0 ? (
                    <Link
                      to={`/choose-schedule?facility=${facility.id}`}
                      className="rounded bg-accent px-3 py-2 text-xs font-bold text-white hover:brightness-110"
                    >
                      Book this court
                    </Link>
                  ) : (
                    <span className="rounded border border-border px-3 py-2 text-xs font-semibold text-muted">
                      Unavailable
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default FacilitiesPage
