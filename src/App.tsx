import { useEffect, useState } from 'react'
import { subDays } from 'date-fns'
import TopBar, { type Theme } from './components/TopBar'
import CalendarPage from './features/calendar/CalendarPage'
import DashboardPage from './features/dashboard/DashboardPage'
import FinancePage from './features/finance/FinancePage'
import FitnessPage from './features/fitness/FitnessPage'
import StreaksPage from './features/streaks/StreaksPage'
import TimePage from './features/time/TimePage'
import AuthPage from './auth/AuthPage'
import { useAuth } from './auth/context'
import { toDateKey, todayKey } from './lib/dates'
import type { CalendarEvent, Tracker, User } from './types'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'streaks', label: 'Streaks', icon: '🔥' },
  { id: 'finance', label: 'Finances', icon: '💰' },
  { id: 'fitness', label: 'Fitness', icon: '💪' },
  { id: 'time', label: 'Time', icon: '⏱️' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
] as const

type PageId = (typeof PAGES)[number]['id']

const SEED_TRACKERS: Tracker[] = [
  { id: 't1', name: 'Daily reading', startDate: toDateKey(subDays(new Date(), 12)), color: '#4f46e5' },
  { id: 't2', name: 'No soda', startDate: toDateKey(subDays(new Date(), 45)), color: '#db2777' },
]

const SEED_EVENTS: CalendarEvent[] = [{ id: 'e1', title: 'Dentist', date: todayKey() }]

export default function App() {
  const { status, user, retry } = useAuth()
  const [theme, setTheme] = useState<Theme>('system')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  if (status === 'loading' || status === 'error') {
    return (
      <div className="auth-status">
        <div className="brand">Jackal</div>
        {status === 'error' ? (
          <>
            <p className="muted">Can't reach the server. Is the backend running? Trying again...</p>
            <div>
              <button onClick={retry}>Retry now</button>
            </div>
          </>
        ) : (
          <p className="muted">Loading...</p>
        )}
      </div>
    )
  }

  if (!user) return <AuthPage />

  // Keyed by user so signing out and in as someone else never shows the previous person's screens.
  return <Shell key={user.id} user={user} theme={theme} onThemeChange={setTheme} />
}

type ShellProps = { user: User; theme: Theme; onThemeChange: (theme: Theme) => void }

function Shell({ user, theme, onThemeChange }: ShellProps) {
  const { updateName, signOut } = useAuth()
  const [page, setPage] = useState<PageId>('dashboard')
  // Trackers and events are shared so the calendar can show them.
  const [trackers, setTrackers] = useState<Tracker[]>(SEED_TRACKERS)
  const [events, setEvents] = useState<CalendarEvent[]>(SEED_EVENTS)

  // Every page stays mounted (just hidden) so switching tabs doesn't lose
  // in-memory state, such as a running timer or the dashboard layout.
  const show = (id: PageId) => ({ hidden: page !== id })

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Jackal</div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${page === p.id ? 'active' : ''}`}
            onClick={() => setPage(p.id)}
            aria-current={page === p.id ? 'page' : undefined}
          >
            <span aria-hidden>{p.icon}</span>
            {p.label}
          </button>
        ))}
      </nav>

      <div className="main-col">
        <TopBar
          theme={theme}
          onThemeChange={onThemeChange}
          user={user}
          onNameChange={updateName}
          onSignOut={signOut}
        />
        <main className="content">
          <div {...show('dashboard')}>
            <DashboardPage />
          </div>
          <div {...show('streaks')}>
            <StreaksPage trackers={trackers} setTrackers={setTrackers} />
          </div>
          <div {...show('finance')}>
            <FinancePage />
          </div>
          <div {...show('fitness')}>
            <FitnessPage />
          </div>
          <div {...show('time')}>
            <TimePage />
          </div>
          <div {...show('calendar')}>
            <CalendarPage trackers={trackers} events={events} setEvents={setEvents} />
          </div>
        </main>
      </div>
    </div>
  )
}
