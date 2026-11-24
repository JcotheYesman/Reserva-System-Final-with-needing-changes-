import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncState from '../components/ui/AsyncState'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeading from '../components/ui/PageHeading'
import { userService } from '../services/userService'

const notificationStyles = {
  success: { tone: 'success', symbol: '✓', className: 'bg-success/15 text-success' },
  info: { tone: 'info', symbol: 'i', className: 'bg-info/15 text-info' },
  warning: { tone: 'pending', symbol: '!', className: 'bg-accent/15 text-accent' },
  danger: { tone: 'danger', symbol: '×', className: 'bg-danger/15 text-danger' },
}

function NotificationsPage() {
  const [notifications, setNotifications] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [markingNotificationId, setMarkingNotificationId] = useState(null)
  const reload = useCallback(async () => {
    const sequence = ++requestSequence.current
    try {
      const latest = await userService.getNotifications()
      if (sequence === requestSequence.current) {
        setNotifications(latest)
        setError('')
      }
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications.')
      }
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void reload(), 0)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 20_000)
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    window.addEventListener('reserva:notifications-changed', reload)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(timer)
      window.removeEventListener('reserva:notifications-changed', reload)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      requestSequence.current += 1
    }
  }, [reload])

  const unreadCount = (notifications ?? []).filter((item) => item.unread).length

  async function markAllRead() {
    setIsUpdating(true)
    setUpdateError('')
    try {
      await userService.markAllNotificationsRead()
    } catch (updateFailure) {
      setUpdateError(updateFailure instanceof Error ? updateFailure.message : 'Notifications could not be updated.')
    } finally {
      setIsUpdating(false)
    }
  }

  async function markNotificationRead(notification) {
    if (!notification.unread || markingNotificationId !== null) return
    setMarkingNotificationId(notification.id)
    setUpdateError('')
    try {
      await userService.markNotificationRead(notification.id)
      setNotifications((current) => current?.map((item) =>
        item.id === notification.id ? { ...item, unread: false } : item,
      ) ?? current)
    } catch (readError) {
      setUpdateError(readError instanceof Error ? readError.message : 'This notification could not be marked as read.')
    } finally {
      setMarkingNotificationId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeading
        title="Notifications"
        description={unreadCount ? `You have ${unreadCount} unread updates.` : 'You’re all caught up.'}
        action={
          <Button variant="secondary" disabled={!unreadCount || isUpdating} onClick={markAllRead}>
            {isUpdating ? 'Updating…' : 'Mark all as read'}
          </Button>
        }
      />
      {updateError ? <p role="alert" className="text-sm text-danger">{updateError}</p> : null}
      <AsyncState loading={isLoading} error={error} onRetry={reload} empty={!isLoading && !error && !notifications?.length} emptyMessage="You have no notifications." />
      {!isLoading && !error && notifications?.length ? (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const style = notificationStyles[notification.type] ?? notificationStyles.info
            return (
              <li key={notification.id}>
                <Card className={`flex items-start gap-3 ${notification.unread ? 'border-l-2 border-l-accent' : ''}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${style.className}`} aria-hidden="true">
                    {style.symbol}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">{notification.title}</h2>
                      <div className="flex items-center gap-2">
                        {notification.unread ? <Badge tone="pending">New</Badge> : null}
                        <time className="text-xs text-muted">{notification.time}</time>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!notification.unread || markingNotificationId === notification.id}
                      onClick={() => markNotificationRead(notification)}
                      aria-label={notification.unread ? `Mark notification as read: ${notification.title}` : notification.message}
                      className="mt-1 block w-full whitespace-pre-wrap break-words text-left text-sm leading-5 text-muted disabled:cursor-default"
                    >
                      {notification.message}
                    </button>
                  </div>
                  {notification.unread ? <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                </Card>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export default NotificationsPage
