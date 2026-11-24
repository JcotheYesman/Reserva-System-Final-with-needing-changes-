import { api } from './api'

async function allReservations() {
  const result = await api('reservations.list')
  return Array.isArray(result.data) ? result.data : []
}

function calendarBooking(reservation) {
  return {
    id: reservation.id,
    user: reservation.user || 'Customer',
    facility: reservation.name,
    sport: reservation.sport ?? '',
    courtNames: Array.isArray(reservation.courtNames) ? reservation.courtNames : [],
    courtSchedules: Array.isArray(reservation.courtSchedules) ? reservation.courtSchedules : [],
    quantity: Number(reservation.quantity ?? 1),
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    time: reservation.time,
    status: reservation.status,
  }
}

export const reservationsService = {
  async getCalendarMonth(year, month) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
    const bookings = (await allReservations()).filter((reservation) => String(reservation.date).startsWith(prefix))
    return bookings.reduce((byDate, reservation) => {
      byDate[reservation.date] ??= []
      byDate[reservation.date].push(calendarBooking(reservation))
      return byDate
    }, {})
  },
  async getScheduleByDate(date) {
    return (await allReservations())
      .filter((reservation) => reservation.date === date)
      .map(calendarBooking)
  },
}
