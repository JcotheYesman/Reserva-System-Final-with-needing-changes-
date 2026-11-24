import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AsyncState from '../components/ui/AsyncState'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeading from '../components/ui/PageHeading'
import Select from '../components/ui/Select'
import StarRating from '../components/ui/StarRating'
import useAsyncResource from '../hooks/useAsyncResource'
import { reservationService } from '../services/reservationService'
import { userService } from '../services/userService'

function FeedbackPage() {
  const [searchParams] = useSearchParams()
  const [reservationId, setReservationId] = useState(searchParams.get('reservation') ?? '')
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const loader = useCallback(async () => {
    const [reservations, reviews, profile] = await Promise.all([
      reservationService.getReservedSchedule(),
      userService.getReviews(),
      userService.getProfile(),
    ])
    const reviewedIds = new Set(reviews.filter((review) => Number(review.userId) === Number(profile.id)).map((review) => String(review.reservationId)))
    const eligibleReservations = reservations.filter((reservation) => reservation.status === 'Completed' && !reviewedIds.has(String(reservation.id)))
    return { reservations, reviews, profile, eligibleReservations }
  }, [])
  const { data, isLoading, error, reload } = useAsyncResource(loader)
  const selectedReservation = useMemo(() => data?.eligibleReservations.find((item) => String(item.id) === String(reservationId)), [data, reservationId])
  const reservationOptions = (data?.eligibleReservations ?? []).map((reservation) => ({
    value: String(reservation.id),
    label: `${reservation.name} · ${reservation.date} · ${reservation.time}`,
  }))

  async function submitFeedback(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!selectedReservation) {
      setErrorMessage('Choose a completed reservation before submitting a review.')
      return
    }
    if (!rating) {
      setErrorMessage('Choose a star rating before submitting.')
      return
    }
    if (comment.trim().length < 8) {
      setErrorMessage('Please add a little more detail to your review.')
      return
    }
    setIsSubmitting(true)
    try {
      await userService.submitReview({
        reservationId: Number(selectedReservation.id),
        facilityId: Number(selectedReservation.facilityId),
        rating,
        text: comment.trim(),
      })
      setComment('')
      setRating(0)
      setReservationId('')
      setSuccessMessage('Thanks for sharing your feedback.')
      reload()
    } catch (submitError) {
      setErrorMessage(submitError instanceof Error ? submitError.message : 'Your review could not be submitted.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeading title="Feedback & Ratings" description="Review a facility after your completed reservation." />
      <AsyncState loading={isLoading} error={error} onRetry={reload} />
      {data ? (
        <>
          <Card>
            <form onSubmit={submitFeedback} className="space-y-4">
              {reservationOptions.length ? (
                <Select label="Completed reservation" value={reservationId} onChange={(event) => setReservationId(event.target.value)} options={[{ value: '', label: 'Choose a completed booking' }, ...reservationOptions]} />
              ) : <p className="rounded-md border border-border bg-bg px-3 py-3 text-sm text-muted">You can submit a review after a confirmed booking has ended. Each completed reservation can be reviewed once.</p>}
              {selectedReservation ? <p className="text-xs text-muted">Reviewing <strong className="text-text">{selectedReservation.name}</strong> · {selectedReservation.date} · {selectedReservation.time}</p> : null}
              <fieldset disabled={!selectedReservation || isSubmitting}>
                <legend className="mb-2 text-xs font-medium text-muted">Your rating</legend>
                <StarRating value={rating} onChange={setRating} label="Select a rating from one to five stars" />
              </fieldset>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">Your review</span>
                <textarea rows="4" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What was your experience at this facility?" disabled={!selectedReservation || isSubmitting} className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted" />
              </label>
              {errorMessage ? <p role="alert" className="text-sm text-danger">{errorMessage}</p> : null}
              {successMessage ? <p role="status" className="text-sm text-success">{successMessage}</p> : null}
              <Button type="submit" disabled={!selectedReservation || isSubmitting}>{isSubmitting ? 'Submitting…' : 'Submit review'}</Button>
            </form>
          </Card>
          <section className="space-y-3">
            <h2 className="text-sm font-bold">Recent Reviews</h2>
            {data.reviews.length ? data.reviews.map((review) => (
              <Card key={review.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{review.user}</h3>
                    <p className="mt-1 text-xs text-muted">{review.facility ?? 'Sports Facility'}</p>
                  </div>
                  <StarRating value={review.rating} readOnly label={`${review.rating} out of 5 stars`} />
                </div>
                <p className="mt-3 text-sm leading-6 text-muted">{review.text}</p>
              </Card>
            )) : <Card><p className="text-sm text-muted">No reviews yet.</p></Card>}
          </section>
        </>
      ) : null}
      <Link to="/sports-facilities" className="inline-block text-xs font-semibold text-success hover:underline">Browse facilities</Link>
    </div>
  )
}

export default FeedbackPage
